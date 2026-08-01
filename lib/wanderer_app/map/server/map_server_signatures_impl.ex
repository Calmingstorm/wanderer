defmodule WandererApp.Map.Server.SignaturesImpl do
  @moduledoc false

  require Logger

  alias WandererApp.Api.{MapSystem, MapSystemSignature}
  alias WandererApp.Character
  alias WandererApp.User.ActivityTracker
  alias WandererApp.Map.Server.{ConnectionsImpl, Impl, SignatureSnapshot, SystemsImpl}
  alias WandererApp.Repo.TransactionNotifications
  alias WandererApp.Utils.EVEUtil

  @doc """
  Public entrypoint for updating signatures on a map system.
  """
  def update_signatures(map_id, params) do
    case update_signatures_checked(map_id, params) do
      :ok ->
        :ok

      {:error, reason} ->
        # Keep the legacy outward contract used by REST/import callers.
        Logger.error("Signature update transaction failed: #{inspect(reason)}")
        :ok
    end
  end

  @doc false
  def update_signatures_checked(
        map_id,
        %{
          solar_system_id: system_solar_id,
          character_id: char_id,
          user_id: user_id,
          delete_connection_with_sigs: delete_conn?,
          added_signatures: added_params,
          updated_signatures: updated_params,
          removed_signatures: removed_params
        }
      )
      when not is_nil(char_id) do
    safe_signature_transaction(fn ->
      lock_map_signature_updates!(map_id)

      case MapSystem.read_by_map_and_solar_system(%{
             map_id: map_id,
             solar_system_id: system_solar_id
           }) do
        {:ok, system} ->
          lock_system_rows!([system.id])

          case do_update_signatures(
                 map_id,
                 system,
                 char_id,
                 user_id,
                 delete_conn?,
                 added_params,
                 updated_params,
                 removed_params
               ) do
            :ok -> :ok
            {:error, reason} -> WandererApp.Repo.rollback(reason)
          end

        error ->
          WandererApp.Repo.rollback({:system_not_found, error})
      end
    end)
    |> case do
      {:ok, :ok} -> :ok
      {:ok, other} -> {:error, {:unexpected_update_result, other}}
      {:error, reason} -> {:error, reason}
    end
  end

  def update_signatures_checked(_map_id, _), do: {:error, :invalid_signature_update}

  @doc """
  Atomically reconciles additions and updates against a locked client snapshot.
  Delayed removals are not applied here; durable baselines are returned only
  after the transaction commits so the caller can safely schedule them.
  """
  def reconcile_signatures(
        map_id,
        %{
          solar_system_id: system_solar_id,
          character_id: char_id,
          user_id: user_id,
          added_signatures: added_params,
          updated_signatures: updated_params,
          removed_signatures: removed_params,
          base_signatures: expected
        } = params
      )
      when not is_nil(char_id) and is_list(expected) do
    safe_signature_transaction(fn ->
      lock_map_signature_updates!(map_id)

      case MapSystem.read_by_map_and_solar_system(%{
             map_id: map_id,
             solar_system_id: system_solar_id
           }) do
        {:ok, system} ->
          lock_system_rows!([system.id])
          locked_signatures = lock_active_signature_rows!(system.id)
          pending_eve_ids = Map.get(params, :pending_eve_ids, MapSet.new())
          current = SignatureSnapshot.current(locked_signatures, pending_eve_ids)

          if SignatureSnapshot.matches?(expected, current) do
            baselines = removal_baselines(locked_signatures, removed_params)

            case do_update_signatures(
                   map_id,
                   system,
                   char_id,
                   user_id,
                   Map.get(params, :delete_connection_with_sigs, false),
                   added_params,
                   updated_params,
                   []
                 ) do
              :ok -> {:applied, baselines}
              {:error, reason} -> WandererApp.Repo.rollback(reason)
            end
          else
            :stale
          end

        _ ->
          :stale
      end
    end)
    |> case do
      {:ok, result} -> result
      {:error, reason} -> {:error, reason}
    end
  end

  # Guarded reconciliation never accepts an absent or malformed snapshot.
  def reconcile_signatures(_map_id, _params), do: :stale

  @doc """
  Captures the durable identity and version of an active signature for a delayed
  removal. Both fields are required so that deleting and recreating an otherwise
  identical scanner row invalidates the pending removal.
  """
  def removal_baseline(map_id, solar_system_id, eve_id) do
    with {:ok, system} <-
           MapSystem.read_by_map_and_solar_system(%{
             map_id: map_id,
             solar_system_id: solar_system_id
           }),
         %MapSystemSignature{} = signature <-
           system.id
           |> MapSystemSignature.by_system_id!()
           |> Enum.find(&(&1.eve_id == eve_id)) do
      baseline(signature)
    else
      _ -> nil
    end
  end

  @doc """
  Removes a delayed signature only while the locked database row still matches
  the identity, version, and content captured when removal was scheduled.
  """
  def remove_signature_if_unchanged(
        map_id,
        %{
          solar_system_id: solar_system_id,
          character_id: character_id,
          user_id: user_id,
          delete_connection_with_sigs: delete_conn?,
          signature: signature,
          baseline: expected_baseline
        }
      )
      when is_map(expected_baseline) and not is_nil(character_id) do
    safe_signature_transaction(fn ->
      lock_map_signature_updates!(map_id)

      case MapSystem.read_by_map_and_solar_system(%{
             map_id: map_id,
             solar_system_id: solar_system_id
           }) do
        {:ok, system} ->
          # Read only to discover the candidate target. Do not hold a signature
          # lock while waiting for system locks: reciprocal removals would otherwise
          # each hold one signature and wait for the other's system/signature.
          candidate_signature = read_signature_row(system.id, signature["eve_id"])
          candidate_target_id = linked_target_system_id(map_id, candidate_signature)
          lock_system_rows!([system.id, candidate_target_id])

          # Once all involved systems are locked in canonical order, lock and
          # validate the source row. A changed target invalidates this attempt.
          locked_signature = lock_signature_row!(system.id, signature["eve_id"])
          locked_target_id = linked_target_system_id(map_id, locked_signature)

          if locked_target_id == candidate_target_id and
               maybe_baseline(locked_signature) == expected_baseline do
            case do_update_signatures(
                   map_id,
                   system,
                   character_id,
                   user_id,
                   delete_conn?,
                   [],
                   [],
                   [signature]
                 ) do
              :ok -> :removed
              {:error, reason} -> WandererApp.Repo.rollback(reason)
            end
          else
            :stale
          end

        _ ->
          :stale
      end
    end)
    |> case do
      {:ok, result} ->
        result

      {:error, reason} ->
        Logger.error("Guarded signature removal failed: #{inspect(reason)}")
        {:error, reason}
    end
  end

  def remove_signature_if_unchanged(_map_id, _params), do: :stale

  # Serialize signature graph mutations per map. Source-only, reciprocal, and
  # delayed-removal paths all take this transaction-scoped lock before row locks,
  # preventing opposite A→B/B→A lock acquisition across LiveView clients.
  defp lock_map_signature_updates!(map_id) do
    Ecto.Adapters.SQL.query!(
      WandererApp.Repo,
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [to_string(map_id)]
    )

    :ok
  end

  @doc false
  def deterministic_system_lock_order(system_ids) do
    system_ids
    |> Enum.reject(&is_nil/1)
    |> Enum.map(&to_string/1)
    |> Enum.uniq()
    |> Enum.sort()
  end

  defp lock_system_rows!(system_ids) do
    ordered_ids = deterministic_system_lock_order(system_ids)

    Enum.each(ordered_ids, fn system_id ->
      sql = "SELECT id FROM map_system_v1 WHERE id = $1 FOR UPDATE"

      %{num_rows: 1} =
        Ecto.Adapters.SQL.query!(WandererApp.Repo, sql, [dump_uuid(system_id)])
    end)

    :ok
  end

  defp read_signature_row(system_id, eve_id) do
    sql = """
    SELECT id, updated_at, eve_id, character_eve_id, name, temporary_name,
           description, kind, "group", type, custom_info, linked_system_id, deleted
    FROM map_system_signatures_v1
    WHERE system_id = $1 AND eve_id = $2 AND deleted = false
    """

    case Ecto.Adapters.SQL.query!(WandererApp.Repo, sql, [dump_uuid(system_id), eve_id]).rows do
      [row] -> locked_signature_from_row(row)
      _ -> nil
    end
  end

  defp lock_signature_row!(system_id, eve_id) do
    sql = """
    SELECT id, updated_at, eve_id, character_eve_id, name, temporary_name,
           description, kind, "group", type, custom_info, linked_system_id, deleted
    FROM map_system_signatures_v1
    WHERE system_id = $1 AND eve_id = $2 AND deleted = false
    FOR UPDATE
    """

    case Ecto.Adapters.SQL.query!(WandererApp.Repo, sql, [dump_uuid(system_id), eve_id]).rows do
      [row] -> locked_signature_from_row(row)
      _ -> nil
    end
  end

  defp linked_target_system_id(_map_id, nil), do: nil
  defp linked_target_system_id(_map_id, %{linked_system_id: nil}), do: nil

  defp linked_target_system_id(map_id, %{linked_system_id: linked_system_id}) do
    case MapSystem.read_by_map_and_solar_system(%{
           map_id: map_id,
           solar_system_id: linked_system_id
         }) do
      {:ok, target_system} -> target_system.id
      _ -> nil
    end
  end

  defp safe_signature_transaction(fun) do
    TransactionNotifications.transaction(fun)
  rescue
    error -> {:error, normalize_transaction_error(error)}
  catch
    kind, reason -> {:error, normalize_transaction_error({kind, reason})}
  end

  @doc false
  def normalize_transaction_error(%Postgrex.Error{postgres: %{code: code}} = error)
      when code in [:deadlock_detected, :serialization_failure] do
    {:database_conflict, code, Exception.message(error)}
  end

  def normalize_transaction_error(%_{} = error),
    do: {:exception, error.__struct__, Exception.message(error)}

  def normalize_transaction_error({kind, reason}), do: {kind, reason}
  def normalize_transaction_error(reason), do: reason

  defp lock_active_signature_rows!(system_id) do
    sql = """
    SELECT id, updated_at, eve_id, character_eve_id, name, temporary_name,
           description, kind, "group", type, custom_info, linked_system_id, deleted
    FROM map_system_signatures_v1
    WHERE system_id = $1 AND deleted = false
    ORDER BY id
    FOR UPDATE
    """

    WandererApp.Repo
    |> Ecto.Adapters.SQL.query!(sql, [dump_uuid(system_id)])
    |> Map.fetch!(:rows)
    |> Enum.map(&locked_signature_from_row/1)
  end

  defp locked_signature_from_row([
         id,
         updated_at,
         eve_id,
         character_eve_id,
         name,
         temporary_name,
         description,
         kind,
         group,
         type,
         custom_info,
         linked_system_id,
         deleted
       ]) do
    %{
      id: Ecto.UUID.load!(id),
      updated_at: updated_at,
      eve_id: eve_id,
      character_eve_id: character_eve_id,
      name: name,
      temporary_name: temporary_name,
      description: description,
      kind: kind,
      group: group,
      type: type,
      custom_info: custom_info,
      linked_system_id: linked_system_id,
      deleted: deleted
    }
  end

  defp removal_baselines(locked_signatures, removed_params) do
    locked_by_eve_id = Map.new(locked_signatures, &{&1.eve_id, &1})

    Map.new(removed_params, fn signature ->
      eve_id = signature["eve_id"]
      {eve_id, locked_by_eve_id |> Map.get(eve_id) |> maybe_baseline()}
    end)
  end

  defp maybe_baseline(nil), do: nil
  defp maybe_baseline(signature), do: baseline(signature)

  defp baseline(signature) do
    %{
      id: signature.id,
      updated_at: normalize_signature_version(signature.updated_at),
      state: signature_state(signature)
    }
  end

  defp signature_state(signature) do
    Map.take(signature, [
      :eve_id,
      :character_eve_id,
      :name,
      :temporary_name,
      :description,
      :kind,
      :group,
      :type,
      :custom_info,
      :linked_system_id,
      :deleted
    ])
  end

  defp normalize_signature_version(%DateTime{} = value),
    do: value |> DateTime.to_naive() |> NaiveDateTime.to_iso8601()

  defp normalize_signature_version(%NaiveDateTime{} = value),
    do: NaiveDateTime.to_iso8601(value)

  defp normalize_signature_version(value), do: to_string(value)

  defp dump_uuid(value), do: Ecto.UUID.dump!(value)

  defp do_update_signatures(
         map_id,
         system,
         character_id,
         user_id,
         delete_conn?,
         added_params,
         updated_params,
         removed_params
       ) do
    character_eve_id =
      case Character.get_character(character_id) do
        {:ok, %{eve_id: eve_id}} ->
          eve_id

        _ ->
          Logger.warning("Could not get character EVE ID for character_id: #{character_id}")
          nil
      end

    added_sigs = parse_signatures(added_params, character_eve_id, system.id)
    updated_sigs = parse_signatures(updated_params, character_eve_id, system.id)
    removed_sigs = parse_signatures(removed_params, character_eve_id, system.id)

    existing_current = MapSystemSignature.by_system_id!(system.id)
    existing_all = MapSystemSignature.by_system_id_all!(system.id)

    removed_ids = Enum.map(removed_sigs, & &1.eve_id)
    updated_ids = Enum.map(updated_sigs, & &1.eve_id)
    added_ids = Enum.map(added_sigs, & &1.eve_id)

    removals = Enum.filter(existing_current, &(&1.eve_id in removed_ids))
    updates = Enum.filter(existing_current, &(&1.eve_id in updated_ids))

    existing_index =
      existing_all
      |> Enum.filter(&(&1.eve_id in added_ids))
      |> Map.new(&{&1.eve_id, &1})

    with :ok <-
           reduce_mutations(removals, fn signature ->
             remove_signature(map_id, signature, system, delete_conn?)
           end),
         :ok <-
           reduce_mutations(updates, fn existing ->
             update = Enum.find(updated_sigs, &(&1.eve_id == existing.eve_id))
             apply_update_signature(map_id, existing, update)
           end),
         :ok <-
           reduce_mutations(added_sigs, fn signature ->
             case existing_index[signature.eve_id] do
               nil -> create_signature(signature)
               existing -> apply_update_signature(map_id, existing, signature)
             end
           end) do
      notify_signature_changes(
        map_id,
        system,
        user_id,
        character_id,
        added_sigs,
        added_ids,
        updated_ids,
        removed_ids
      )

      :ok
    end
  end

  defp reduce_mutations(items, fun) do
    Enum.reduce_while(items, :ok, fn item, :ok ->
      case fun.(item) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
        other -> {:halt, {:error, {:unexpected_mutation_result, other}}}
      end
    end)
  end

  defp create_signature(params) do
    case MapSystemSignature.create(params) do
      {:ok, _signature} -> :ok
      {:error, reason} -> {:error, {:create_signature, reason}}
    end
  end

  defp destroy_signature(signature) do
    case MapSystemSignature.destroy(signature) do
      :ok -> :ok
      {:ok, _signature} -> :ok
      {:error, reason} -> {:error, {:destroy_signature, signature.id, reason}}
      other -> {:error, {:destroy_signature, signature.id, other}}
    end
  end

  defp notify_signature_changes(
         map_id,
         system,
         user_id,
         character_id,
         added_sigs,
         added_ids,
         updated_ids,
         removed_ids
       ) do
    if added_ids != [] do
      track_activity(
        :signatures_added,
        map_id,
        system.solar_system_id,
        user_id,
        character_id,
        added_ids
      )
    end

    if removed_ids != [] do
      track_activity(
        :signatures_removed,
        map_id,
        system.solar_system_id,
        user_id,
        character_id,
        removed_ids
      )
    end

    Impl.broadcast!(map_id, :signatures_updated, system.solar_system_id)

    Enum.each(added_sigs, fn signature ->
      WandererApp.ExternalEvents.broadcast(map_id, :signature_added, %{
        solar_system_id: system.solar_system_id,
        signature_id: signature.eve_id,
        name: signature.name,
        kind: signature.kind,
        group: signature.group,
        type: signature.type
      })
    end)

    Enum.each(removed_ids, fn eve_id ->
      WandererApp.ExternalEvents.broadcast(map_id, :signature_removed, %{
        solar_system_id: system.solar_system_id,
        signature_id: eve_id
      })
    end)

    WandererApp.ExternalEvents.broadcast(map_id, :signatures_updated, %{
      solar_system_id: system.solar_system_id,
      added_count: length(added_ids),
      updated_count: length(updated_ids),
      removed_count: length(removed_ids)
    })

    :ok
  end

  defp remove_signature(map_id, signature, system, delete_conn?) do
    active? =
      not is_nil(signature.linked_system_id) and
        is_active_signature_for_target?(map_id, signature)

    with :ok <- maybe_delete_active_connection(map_id, system, signature, delete_conn?, active?),
         :ok <- maybe_clear_active_signature(map_id, system, signature, active?),
         :ok <- maybe_remove_back_link(map_id, system, signature, delete_conn?, active?),
         :ok <- destroy_signature(signature) do
      :ok
    end
  end

  defp maybe_delete_active_connection(map_id, system, signature, true, true) do
    ConnectionsImpl.delete_connection(map_id, %{
      solar_system_source_id: system.solar_system_id,
      solar_system_target_id: signature.linked_system_id
    })
    |> normalize_operation_result(:delete_connection)
  end

  defp maybe_delete_active_connection(_map_id, _system, _signature, _delete?, _active?),
    do: :ok

  defp maybe_clear_active_signature(map_id, _system, signature, true) do
    SystemsImpl.update_system_linked_sig_eve_id(map_id, %{
      solar_system_id: signature.linked_system_id,
      linked_sig_eve_id: nil
    })
    |> normalize_operation_result(:clear_linked_signature)
  end

  defp maybe_clear_active_signature(_map_id, _system, _signature, false), do: :ok

  defp maybe_remove_back_link(_map_id, _system, %{linked_system_id: nil}, _delete?, _active?),
    do: :ok

  defp maybe_remove_back_link(map_id, system, signature, delete_conn?, active?) do
    case MapSystem.read_by_map_and_solar_system(%{
           map_id: map_id,
           solar_system_id: signature.linked_system_id
         }) do
      {:ok, target_system} ->
        back_link_sigs =
          target_system.id
          |> MapSystemSignature.by_system_id!()
          |> Enum.filter(&(&1.linked_system_id == system.solar_system_id))

        other_source_sigs =
          system.id
          |> MapSystemSignature.by_system_id!()
          |> Enum.filter(fn other ->
            other.eve_id != signature.eve_id and
              other.linked_system_id == signature.linked_system_id
          end)

        case {back_link_sigs, other_source_sigs} do
          {[back_signature], []} ->
            back_active? = is_active_signature_for_target?(map_id, back_signature)

            with :ok <-
                   maybe_delete_back_link_connection(
                     map_id,
                     system,
                     signature,
                     delete_conn? and not active?
                   ),
                 :ok <-
                   maybe_clear_back_link_signature(
                     map_id,
                     system,
                     back_active?
                   ),
                 :ok <- destroy_signature(back_signature) do
              Impl.broadcast!(map_id, :signatures_updated, target_system.solar_system_id)

              WandererApp.ExternalEvents.broadcast(map_id, :signature_removed, %{
                solar_system_id: target_system.solar_system_id,
                signature_id: back_signature.eve_id
              })

              WandererApp.ExternalEvents.broadcast(map_id, :signatures_updated, %{
                solar_system_id: target_system.solar_system_id,
                added_count: 0,
                updated_count: 0,
                removed_count: 1
              })

              :ok
            end

          _ ->
            :ok
        end

      _ ->
        :ok
    end
  end

  defp maybe_delete_back_link_connection(map_id, system, signature, true) do
    ConnectionsImpl.delete_connection(map_id, %{
      solar_system_source_id: system.solar_system_id,
      solar_system_target_id: signature.linked_system_id
    })
    |> normalize_operation_result(:delete_back_link_connection)
  end

  defp maybe_delete_back_link_connection(_map_id, _system, _signature, false), do: :ok

  defp maybe_clear_back_link_signature(map_id, system, true) do
    SystemsImpl.update_system_linked_sig_eve_id(map_id, %{
      solar_system_id: system.solar_system_id,
      linked_sig_eve_id: nil
    })
    |> normalize_operation_result(:clear_back_linked_signature)
  end

  defp maybe_clear_back_link_signature(_map_id, _system, false), do: :ok

  defp normalize_operation_result(:ok, _operation), do: :ok
  defp normalize_operation_result(nil, _operation), do: :ok
  defp normalize_operation_result({:ok, _value}, _operation), do: :ok
  defp normalize_operation_result({:error, reason}, operation), do: {:error, {operation, reason}}

  defp normalize_operation_result(other, operation),
    do: {:error, {operation, {:unexpected_result, other}}}

  defp is_active_signature_for_target?(map_id, sig) do
    case MapSystem.read_by_map_and_solar_system(%{
           map_id: map_id,
           solar_system_id: sig.linked_system_id
         }) do
      {:ok, target_system} -> target_system.linked_sig_eve_id == sig.eve_id
      _ -> false
    end
  end

  def apply_update_signature(
        map_id,
        %MapSystemSignature{} = existing,
        update_params
      )
      when not is_nil(update_params) do
    case MapSystemSignature.update(
           existing,
           update_params |> Map.put(:update_forced_at, DateTime.utc_now())
         ) do
      {:ok, updated} ->
        with :ok <-
               normalize_operation_result(
                 maybe_update_connection_time_status(map_id, existing, updated),
                 :sync_connection_time_status
               ),
             :ok <-
               normalize_operation_result(
                 maybe_update_connection_mass_status(map_id, existing, updated),
                 :sync_connection_ship_size
               ),
             :ok <-
               normalize_operation_result(
                 maybe_sync_custom_mass_status_to_connection(map_id, existing, updated),
                 :sync_connection_mass_status
               ) do
          :ok
        end

      {:error, reason} ->
        Logger.error("Failed to update signature #{existing.id}: #{inspect(reason)}")
        {:error, {:update_signature, existing.id, reason}}
    end
  end

  defp maybe_update_connection_time_status(
         map_id,
         %{custom_info: old_custom_info} = _old_sig,
         %{custom_info: new_custom_info, system_id: system_id, linked_system_id: linked_system_id} =
           _updated_sig
       )
       when not is_nil(linked_system_id) do
    old_time_status = get_time_status(old_custom_info)
    new_time_status = get_time_status(new_custom_info)

    if old_time_status != new_time_status do
      {:ok, source_system} = MapSystem.by_id(system_id)

      ConnectionsImpl.update_connection_time_status(map_id, %{
        solar_system_source_id: source_system.solar_system_id,
        solar_system_target_id: linked_system_id,
        time_status: new_time_status
      })
    end
  end

  defp maybe_update_connection_time_status(_map_id, _old_sig, _updated_sig), do: :ok

  defp maybe_update_connection_mass_status(
         map_id,
         %{type: old_type} = _old_sig,
         %{type: new_type, system_id: system_id, linked_system_id: linked_system_id} =
           _updated_sig
       )
       when not is_nil(linked_system_id) do
    if old_type != new_type do
      {:ok, source_system} = MapSystem.by_id(system_id)
      signature_ship_size_type = EVEUtil.get_wh_size(new_type)

      if not is_nil(signature_ship_size_type) do
        ConnectionsImpl.update_connection_ship_size_type(map_id, %{
          solar_system_source_id: source_system.solar_system_id,
          solar_system_target_id: linked_system_id,
          ship_size_type: signature_ship_size_type
        })
      end
    end
  end

  defp maybe_update_connection_mass_status(_map_id, _old_sig, _updated_sig), do: :ok

  defp maybe_sync_custom_mass_status_to_connection(
         map_id,
         %{custom_info: old_custom_info} = _old_sig,
         %{custom_info: new_custom_info, system_id: system_id, linked_system_id: linked_system_id} =
           _updated_sig
       )
       when not is_nil(linked_system_id) do
    old_mass_status = get_mass_status(old_custom_info)
    new_mass_status = get_mass_status(new_custom_info)

    if old_mass_status != new_mass_status and not is_nil(new_mass_status) do
      {:ok, source_system} = MapSystem.by_id(system_id)

      ConnectionsImpl.update_connection_mass_status(map_id, %{
        solar_system_source_id: source_system.solar_system_id,
        solar_system_target_id: linked_system_id,
        mass_status: new_mass_status
      })
    end
  end

  defp maybe_sync_custom_mass_status_to_connection(_map_id, _old_sig, _updated_sig), do: :ok

  @doc """
  Finds the "forward" signature in a target system that links back to the source system.
  Used for back-link detection: when a K162 is linked from System B → System A,
  finds the existing signature in System A that already links to System B (e.g., H296).
  """
  def find_forward_signature(target_system_uuid, source_solar_system_id) do
    target_system_uuid
    |> MapSystemSignature.by_system_id!()
    |> Enum.find(fn sig -> sig.linked_system_id == source_solar_system_id end)
  rescue
    e ->
      Logger.warning("[find_forward_signature] Error: #{inspect(e)}")
      nil
  end

  @doc """
  Wrapper for updating a signature's linked_system_id with logging.
  Logs all unlink operations (when linked_system_id is set to nil) with context
  to help diagnose unexpected unlinking issues.
  """
  def update_signature_linked_system(signature, %{linked_system_id: nil} = params) do
    # Log all unlink operations with context for debugging
    Logger.warning(
      "[Signature Unlink] eve_id=#{signature.eve_id} " <>
        "system_id=#{signature.system_id} " <>
        "old_linked_system_id=#{signature.linked_system_id} " <>
        "stacktrace=#{format_stacktrace()}"
    )

    MapSystemSignature.update_linked_system(signature, params)
  end

  def update_signature_linked_system(signature, params) do
    MapSystemSignature.update_linked_system(signature, params)
  end

  defp format_stacktrace do
    {:current_stacktrace, stacktrace} = Process.info(self(), :current_stacktrace)

    stacktrace
    |> Enum.take(10)
    |> Enum.map_join(" <- ", fn {mod, fun, arity, _} ->
      "#{inspect(mod)}.#{fun}/#{arity}"
    end)
  end

  defp track_activity(event, map_id, solar_system_id, user_id, character_id, signatures) do
    ActivityTracker.track_map_event(event, %{
      map_id: map_id,
      solar_system_id: solar_system_id,
      user_id: user_id,
      character_id: character_id,
      signatures: signatures
    })
  end

  @doc false
  defp parse_signatures(signatures, character_eve_id, system_id) do
    Enum.map(signatures, fn sig ->
      base = %{
        system_id: system_id,
        eve_id: sig["eve_id"],
        name: sig["name"],
        temporary_name: sig["temporary_name"],
        description: Map.get(sig, "description"),
        kind: sig["kind"],
        group: sig["group"],
        type: Map.get(sig, "type"),
        custom_info: Map.get(sig, "custom_info"),
        # Use character_eve_id from sig if provided, otherwise use the default
        character_eve_id: Map.get(sig, "character_eve_id", character_eve_id),
        deleted: false
      }

      # Only include linked_system_id when explicitly provided in the payload.
      # Frontend sends "linked_system" (object), not "linked_system_id" (integer).
      # Including nil would silently clear the DB value via the Ash :update action.
      if Map.has_key?(sig, "linked_system_id") do
        Map.put(base, :linked_system_id, sig["linked_system_id"])
      else
        base
      end
    end)
  end

  defp get_time_status(nil), do: nil

  defp get_time_status(custom_info_json) do
    custom_info_json
    |> Jason.decode!()
    |> Map.get("time_status")
  end

  defp get_mass_status(nil), do: nil

  defp get_mass_status(custom_info_json) do
    custom_info_json
    |> Jason.decode!()
    |> Map.get("mass_status")
  end
end

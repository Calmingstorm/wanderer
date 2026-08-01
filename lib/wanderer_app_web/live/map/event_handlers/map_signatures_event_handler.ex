defmodule WandererAppWeb.MapSignaturesEventHandler do
  use WandererAppWeb, :live_component
  use Phoenix.Component
  require Logger

  alias WandererAppWeb.{MapEventHandler, MapCoreEventHandler}
  alias WandererApp.Map.Server.{Impl, SignatureSnapshot, SignaturesImpl}
  alias WandererApp.Utils.EVEUtil

  def handle_server_event(
        %{
          event: :maybe_link_signature,
          payload: %{
            character_id: character_id,
            solar_system_source: solar_system_source,
            solar_system_target: solar_system_target
          }
        },
        %{
          assigns: %{
            current_user: current_user,
            map_id: map_id,
            map_user_settings: map_user_settings
          }
        } = socket
      ) do
    is_user_character =
      current_user.characters |> Enum.map(& &1.id) |> Enum.member?(character_id)

    is_link_signature_on_splash =
      map_user_settings
      |> WandererApp.MapUserSettingsRepo.to_form_data!()
      |> WandererApp.MapUserSettingsRepo.get_boolean_setting("link_signature_on_splash")

    {:ok, signatures} =
      WandererApp.Api.MapSystem.read_by_map_and_solar_system(%{
        map_id: map_id,
        solar_system_id: solar_system_source
      })
      |> case do
        {:ok, system} ->
          {:ok,
           get_system_signatures(system.id)
           |> Enum.filter(fn signature ->
             is_nil(signature.linked_system) && signature.group == "Wormhole"
           end)}

        _ ->
          {:ok, []}
      end

    (is_user_character && is_link_signature_on_splash && not (signatures |> Enum.empty?()))
    |> case do
      true ->
        socket
        |> MapEventHandler.push_map_event("link_signature_to_system", %{
          solar_system_source: solar_system_source,
          solar_system_target: solar_system_target
        })

      false ->
        socket
    end
  end

  def handle_server_event(
        %{event: :signatures_updated, payload: solar_system_id},
        socket
      ),
      do:
        socket
        |> MapEventHandler.push_map_event(
          "signatures_updated",
          solar_system_id
        )

  # Legacy timers from older callers are still accepted, but all new delayed
  # removals carry a per-system/per-signature token.
  def handle_server_event(
        %{event: :remove_signatures, payload: {solar_system_id, removed_signatures}},
        socket
      ),
      do:
        handle_server_event(
          %{
            event: :remove_signatures,
            payload: {solar_system_id, removed_signatures, :use_user_setting}
          },
          socket
        )

  def handle_server_event(
        %{
          event: :remove_signatures,
          payload: {solar_system_id, removed_signatures, _delete_connections?}
        },
        socket
      ) do
    # Translate the old aggregate timer to token-aware events. If no matching
    # pending request exists it is safely ignored.
    Enum.reduce(removed_signatures, socket, fn signature, acc ->
      key = removal_key(solar_system_id, signature["eve_id"])

      case pending_removals(acc.assigns)[key] do
        %{token: token} ->
          handle_server_event(
            %{event: :remove_signature, payload: {elem(key, 0), signature, token}},
            acc
          )

        _ ->
          acc
      end
    end)
  end

  def handle_server_event(
        %{event: :legacy_remove_signatures, payload: {solar_system_id, removed_signatures}},
        %{
          assigns: %{
            current_user: %{id: current_user_id},
            main_character_id: main_character_id,
            map_id: map_id,
            map_user_settings: map_user_settings,
            user_permissions: user_permissions
          }
        } = socket
      ) do
    delete_connection_with_sigs =
      delete_connections_for_removal?(
        :use_user_setting,
        map_user_settings,
        user_permissions
      )

    WandererApp.Map.Server.update_signatures(map_id, %{
      solar_system_id: get_integer(solar_system_id),
      character_id: main_character_id,
      user_id: current_user_id,
      delete_connection_with_sigs: delete_connection_with_sigs,
      added_signatures: [],
      updated_signatures: [],
      removed_signatures: removed_signatures
    })

    socket
  end

  def handle_server_event(
        %{event: :remove_signature, payload: {solar_system_id, signature, token}},
        %{
          assigns: %{
            current_user: %{id: current_user_id},
            main_character_id: main_character_id,
            map_id: map_id,
            map_user_settings: map_user_settings,
            user_permissions: user_permissions
          }
        } = socket
      ) do
    key = removal_key(solar_system_id, signature["eve_id"])
    pending = pending_removals(socket.assigns)

    case pending_removal_matches?(pending, key, token) do
      {:ok, %{delete_connections: delete_connections?, baseline: baseline}} ->
        delete_connection_with_sigs =
          delete_connections_for_removal?(
            delete_connections?,
            map_user_settings,
            user_permissions
          )

        result =
          SignaturesImpl.remove_signature_if_unchanged(map_id, %{
            solar_system_id: elem(key, 0),
            character_id: main_character_id,
            user_id: current_user_id,
            delete_connection_with_sigs: delete_connection_with_sigs,
            signature: signature,
            baseline: baseline
          })

        socket = assign(socket, pending_signature_removals: Map.delete(pending, key))

        if guarded_removal_needs_refresh?(result) do
          if match?({:error, _}, result) do
            Logger.error("Guarded signature removal failed: #{inspect(result)}")
          end

          Impl.broadcast!(map_id, :signatures_updated, elem(key, 0))
        end

        socket

      _ ->
        # Superseded/cancelled timers must never delete restored or replaced data.
        socket
    end
  end

  @doc false
  def delete_connections_for_removal?(mode, map_user_settings, user_permissions) do
    can_delete_connection? = Map.get(user_permissions, :delete_connection, false)

    requested? =
      case mode do
        true ->
          true

        :use_user_setting ->
          map_user_settings
          |> WandererApp.MapUserSettingsRepo.to_form_data!()
          |> WandererApp.MapUserSettingsRepo.get_boolean_setting("delete_connection_with_sigs")

        _ ->
          false
      end

    requested? and can_delete_connection?
  end

  def handle_server_event(event, socket),
    do: MapCoreEventHandler.handle_server_event(event, socket)

  def handle_ui_event(
        "load_signatures",
        _event,
        %{
          assigns: %{
            map_id: map_id
          }
        } = socket
      ) do
    {:ok, systems} = map_id |> WandererApp.Map.list_systems()

    system_signatures =
      systems
      |> Enum.reduce(%{}, fn %{id: system_id, solar_system_id: solar_system_id}, acc ->
        signatures = get_system_signatures(system_id)
        acc |> Map.put(solar_system_id, signatures)
      end)

    {:noreply,
     socket
     |> MapEventHandler.push_map_event(
       "map_updated",
       %{system_signatures: system_signatures}
     )}
  end

  def handle_ui_event(
        "update_signatures",
        %{
          "system_id" => solar_system_id,
          "added" => added_signatures,
          "updated" => updated_signatures,
          "removed" => removed_signatures,
          "deleteTimeout" => delete_timeout
        } = event,
        %{
          assigns: %{
            current_user: %{id: current_user_id},
            map_id: map_id,
            main_character_id: main_character_id,
            user_permissions: %{update_system: true}
          }
        } = socket
      )
      when not is_nil(main_character_id) do
    solar_system_id = get_integer(solar_system_id)
    pending = pending_removals(socket.assigns)

    pending_eve_ids =
      pending
      |> Map.keys()
      |> Enum.filter(fn {system_id, _eve_id} -> system_id == solar_system_id end)
      |> Enum.map(&elem(&1, 1))
      |> MapSet.new()

    case signature_update_mode(event) do
      :legacy ->
        # Old clients predate reconciliation snapshots and explicit connection policy.
        # Keep their historical delayed-removal semantics, but never let a crafted
        # new request with deleteConnections fall through this compatibility path.
        WandererApp.Map.Server.update_signatures(map_id, %{
          solar_system_id: solar_system_id,
          character_id: main_character_id,
          user_id: current_user_id,
          delete_connection_with_sigs: false,
          added_signatures: added_signatures,
          updated_signatures: updated_signatures,
          removed_signatures: []
        })

        if removed_signatures != [] do
          Process.send_after(
            self(),
            %{
              event: :legacy_remove_signatures,
              payload: {solar_system_id, removed_signatures}
            },
            max(get_integer(delete_timeout) || 0, 0)
          )
        end

        {:reply, %{result: "applied", applied: true}, socket}

      :guarded ->
        result =
          SignaturesImpl.reconcile_signatures(map_id, %{
            solar_system_id: solar_system_id,
            character_id: main_character_id,
            user_id: current_user_id,
            delete_connection_with_sigs: false,
            added_signatures: added_signatures,
            updated_signatures: updated_signatures,
            removed_signatures: removed_signatures,
            base_signatures: Map.get(event, "baseSignatures"),
            pending_eve_ids: pending_eve_ids
          })

        case result do
          :stale ->
            {:reply, %{result: "stale", applied: false}, socket}

          {:applied, baselines} ->
            delete_connections? = Map.get(event, "deleteConnections") == true

            restored_ids =
              (added_signatures ++ updated_signatures)
              |> Enum.map(& &1["eve_id"])
              |> Enum.reject(&is_nil/1)

            pending = cancel_pending_removals(pending, solar_system_id, restored_ids)

            pending =
              Enum.reduce(removed_signatures, pending, fn signature, acc ->
                token = make_ref()
                eve_id = signature["eve_id"]
                key = removal_key(solar_system_id, eve_id)

                Process.send_after(
                  self(),
                  %{event: :remove_signature, payload: {solar_system_id, signature, token}},
                  max(get_integer(delete_timeout) || 0, 0)
                )

                Map.put(acc, key, %{
                  token: token,
                  signature: signature,
                  delete_connections: delete_connections?,
                  baseline: Map.get(baselines, eve_id)
                })
              end)

            {:reply, %{result: "applied", applied: true},
             assign(socket, pending_signature_removals: pending)}

          {:error, reason} ->
            Logger.error("Signature reconciliation failed: #{inspect(reason)}")
            {:reply, %{result: "error", applied: false}, socket}
        end
    end
  end

  def handle_ui_event(
        "get_signatures",
        %{"system_id" => solar_system_id},
        %{
          assigns:
            %{
              map_id: map_id
            } = assigns
        } = socket
      ) do
    case WandererApp.Api.MapSystem.read_by_map_and_solar_system(%{
           map_id: map_id,
           solar_system_id: get_integer(solar_system_id)
         }) do
      {:ok, system} ->
        pending = pending_removals(assigns)

        system_signatures =
          get_system_signatures(system.id)
          |> Enum.map(fn sig ->
            if Map.has_key?(pending, removal_key(solar_system_id, sig.eve_id)) do
              Map.put(sig, :deleted, true)
            else
              sig
            end
          end)

        {:reply, %{signatures: system_signatures}, socket}

      _ ->
        {:reply, %{signatures: []}, socket}
    end
  end

  def handle_ui_event(
        "link_signature_to_system",
        %{
          "signature_eve_id" => signature_eve_id,
          "solar_system_source" => solar_system_source,
          "solar_system_target" => solar_system_target
        },
        %{
          assigns: %{
            map_id: map_id,
            main_character_id: main_character_id,
            has_tracked_characters?: true,
            user_permissions: %{update_system: true}
          }
        } = socket
      )
      when not is_nil(main_character_id) and not is_nil(solar_system_source) and
             not is_nil(solar_system_target) do
    with solar_system_source <- get_integer(solar_system_source),
         solar_system_target <- get_integer(solar_system_target),
         source_system when not is_nil(source_system) <-
           WandererApp.Map.find_system_by_location(
             map_id,
             %{solar_system_id: solar_system_source}
           ),
         signature when not is_nil(signature) <-
           WandererApp.Api.MapSystemSignature.by_system_id!(source_system.id)
           |> Enum.find(fn s -> s.eve_id == signature_eve_id end),
         target_system when not is_nil(target_system) <-
           WandererApp.Map.find_system_by_location(
             map_id,
             %{solar_system_id: solar_system_target}
           ) do
      signature
      |> WandererApp.Api.MapSystemSignature.update_group!(%{group: "Wormhole"})
      |> WandererApp.Api.MapSystemSignature.update_linked_system(%{
        linked_system_id: solar_system_target
      })

      if is_nil(target_system.linked_sig_eve_id) or
           target_system.linked_sig_eve_id == signature_eve_id do
        map_id
        |> WandererApp.Map.Server.update_system_linked_sig_eve_id(%{
          solar_system_id: solar_system_target,
          linked_sig_eve_id: signature_eve_id
        })

        if not is_nil(signature.temporary_name) do
          map_id
          |> WandererApp.Map.Server.update_system_temporary_name(%{
            solar_system_id: solar_system_target,
            temporary_name: signature.temporary_name
          })
        end

        {signature_time_status, signature_mass_status} =
          if not is_nil(signature.custom_info) do
            decoded = signature.custom_info |> Jason.decode!()
            {Map.get(decoded, "time_status"), Map.get(decoded, "mass_status")}
          else
            {nil, nil}
          end

        signature_ship_size_type = EVEUtil.get_wh_size(signature.type)

        # Back-link detection: if current signature yields no ship_size_type (e.g., K162),
        # look for a forward signature in the target system that links back to our source
        {signature_time_status, signature_ship_size_type, signature_mass_status} =
          if is_nil(signature_ship_size_type) do
            case SignaturesImpl.find_forward_signature(target_system.id, solar_system_source) do
              nil ->
                {signature_time_status, signature_ship_size_type, signature_mass_status}

              forward_sig ->
                Logger.info(
                  "[link_signature_to_system] Back-link detected: " <>
                    "using forward sig type=#{forward_sig.type} from target system"
                )

                forward_ship_size = EVEUtil.get_wh_size(forward_sig.type)

                {forward_time_status, forward_mass_status} =
                  if not is_nil(forward_sig.custom_info) do
                    decoded = forward_sig.custom_info |> Jason.decode!()

                    # Always prefer forward sig values over K162 defaults
                    fwd_time = Map.get(decoded, "time_status") || signature_time_status
                    fwd_mass = Map.get(decoded, "mass_status") || signature_mass_status

                    {fwd_time, fwd_mass}
                  else
                    {signature_time_status, signature_mass_status}
                  end

                {forward_time_status, forward_ship_size, forward_mass_status}
            end
          else
            {signature_time_status, signature_ship_size_type, signature_mass_status}
          end

        if not is_nil(signature_time_status) do
          map_id
          |> WandererApp.Map.Server.update_connection_time_status(%{
            solar_system_source_id: solar_system_source,
            solar_system_target_id: solar_system_target,
            time_status: signature_time_status
          })
        end

        if not is_nil(signature_ship_size_type) do
          map_id
          |> WandererApp.Map.Server.update_connection_ship_size_type(%{
            solar_system_source_id: solar_system_source,
            solar_system_target_id: solar_system_target,
            ship_size_type: signature_ship_size_type
          })
        end

        if not is_nil(signature_mass_status) do
          map_id
          |> WandererApp.Map.Server.update_connection_mass_status(%{
            solar_system_source_id: solar_system_source,
            solar_system_target_id: solar_system_target,
            mass_status: signature_mass_status
          })
        end

        # Update K162's custom_info to match the resolved connection values
        if not is_nil(signature_time_status) or not is_nil(signature_mass_status) do
          updated_custom_info =
            (signature.custom_info || "{}")
            |> Jason.decode!()
            |> then(fn decoded ->
              decoded
              |> then(fn d ->
                if not is_nil(signature_time_status),
                  do: Map.put(d, "time_status", signature_time_status),
                  else: d
              end)
              |> then(fn d ->
                if not is_nil(signature_mass_status),
                  do: Map.put(d, "mass_status", signature_mass_status),
                  else: d
              end)
            end)
            |> Jason.encode!()

          WandererApp.Api.MapSystemSignature.update(signature, %{custom_info: updated_custom_info})
        end
      end

      WandererApp.Map.Server.Impl.broadcast!(map_id, :signatures_updated, solar_system_source)

      {:noreply, socket}
    else
      _ ->
        {:noreply, socket}
    end
  end

  def handle_ui_event(
        "unlink_signature",
        %{
          "signature_eve_id" => signature_eve_id,
          "solar_system_source" => solar_system_source
        },
        %{
          assigns: %{
            map_id: map_id,
            main_character_id: main_character_id,
            has_tracked_characters?: true,
            user_permissions: %{update_system: true}
          }
        } = socket
      )
      when not is_nil(main_character_id) do
    solar_system_source = get_integer(solar_system_source)

    case WandererApp.Api.MapSystem.read_by_map_and_solar_system(%{
           map_id: map_id,
           solar_system_id: solar_system_source
         }) do
      {:ok, system} ->
        WandererApp.Api.MapSystemSignature.by_system_id!(system.id)
        |> Enum.filter(fn s -> s.eve_id == signature_eve_id end)
        |> Enum.each(fn s ->
          map_id
          |> WandererApp.Map.Server.update_system_linked_sig_eve_id(%{
            solar_system_id: s.linked_system_id,
            linked_sig_eve_id: nil
          })

          # Use the wrapper to log unlink operations
          WandererApp.Map.Server.SignaturesImpl.update_signature_linked_system(s, %{
            linked_system_id: nil
          })
        end)

        WandererApp.Map.Server.Impl.broadcast!(map_id, :signatures_updated, solar_system_source)

        {:noreply, socket}

      _ ->
        {:noreply, socket}
    end
  end

  def handle_ui_event(
        "undo_delete_signatures",
        %{"system_id" => solar_system_id, "eve_ids" => eve_ids},
        %{
          assigns: %{
            map_id: map_id,
            main_character_id: main_character_id,
            user_permissions: %{update_system: true}
          }
        } = socket
      )
      when not is_nil(main_character_id) do
    solar_system_id = get_integer(solar_system_id)
    pending = cancel_pending_removals(pending_removals(socket.assigns), solar_system_id, eve_ids)
    WandererApp.Map.Server.Impl.broadcast!(map_id, :signatures_updated, solar_system_id)
    {:reply, %{result: "undone"}, assign(socket, pending_signature_removals: pending)}
  end

  def handle_ui_event(event, body, socket),
    do: MapCoreEventHandler.handle_ui_event(event, body, socket)

  @doc false
  def signature_update_mode(event) when is_map(event) do
    if not Map.has_key?(event, "baseSignatures") and
         not Map.has_key?(event, "deleteConnections") do
      :legacy
    else
      :guarded
    end
  end

  @doc false
  def removal_key(solar_system_id, eve_id), do: {get_integer(solar_system_id), eve_id}

  @doc false
  def cancel_pending_removals(pending, solar_system_id, eve_ids) do
    keys = MapSet.new(Enum.map(eve_ids, &removal_key(solar_system_id, &1)))
    Map.reject(pending, fn {key, _value} -> MapSet.member?(keys, key) end)
  end

  @doc false
  def pending_removal_matches?(pending, key, token) do
    case Map.get(pending, key) do
      %{token: ^token} = entry -> {:ok, entry}
      _ -> :stale
    end
  end

  defp pending_removals(assigns), do: Map.get(assigns, :pending_signature_removals, %{})

  @doc false
  def canonical_signature_snapshot(signatures, pending_keys \\ MapSet.new()),
    do: SignatureSnapshot.current(signatures, pending_keys)

  @doc false
  def snapshots_match?(expected, current), do: SignatureSnapshot.matches?(expected, current)

  @doc false
  def guarded_removal_needs_refresh?(:removed), do: false
  def guarded_removal_needs_refresh?(:stale), do: true
  def guarded_removal_needs_refresh?({:error, _reason}), do: true
  def guarded_removal_needs_refresh?(_unexpected), do: true

  def get_system_signatures(system_id) do
    signatures = system_id |> WandererApp.Api.MapSystemSignature.by_system_id!()

    character_eve_ids =
      signatures |> Enum.map(& &1.character_eve_id) |> Enum.reject(&is_nil/1) |> Enum.uniq()

    character_names_map =
      character_eve_ids
      |> Enum.reduce(%{}, fn eve_id, acc ->
        case WandererApp.Character.get_by_eve_id(eve_id) do
          {:ok, character} -> Map.put(acc, eve_id, character.name)
          _ -> acc
        end
      end)

    signatures
    |> Enum.map(fn %{
                     inserted_at: inserted_at,
                     updated_at: updated_at,
                     linked_system_id: linked_system_id
                   } = s ->
      s
      |> Map.take([
        :eve_id,
        :character_eve_id,
        :name,
        :temporary_name,
        :description,
        :kind,
        :group,
        :type,
        :custom_info
      ])
      |> Map.put(:character_name, Map.get(character_names_map, s.character_eve_id))
      |> Map.put(:linked_system, MapEventHandler.get_system_static_info(linked_system_id))
      |> Map.put(:inserted_at, inserted_at |> Calendar.strftime("%Y/%m/%d %H:%M:%S"))
      |> Map.put(:updated_at, updated_at |> Calendar.strftime("%Y/%m/%d %H:%M:%S"))
    end)
  end

  defp get_integer(nil), do: nil
  defp get_integer(value) when is_binary(value), do: String.to_integer(value)
  defp get_integer(value), do: value
end

defmodule WandererApp.Map.Server.SignatureReconciliationTransactionTest do
  use WandererApp.DataCase, async: false

  alias WandererApp.Api.MapSystemSignature
  alias WandererApp.Map.Server.{SignatureSnapshot, SignaturesImpl}
  alias WandererAppWeb.Factory

  setup do
    user = Factory.create_user()
    character = Factory.create_character(%{user_id: user.id})
    map = Factory.create_map(%{owner_id: character.id})

    system =
      Factory.insert(:map_system, %{
        map_id: map.id,
        solar_system_id: 31_000_001,
        name: "J100001"
      })

    signature =
      Factory.insert(:map_system_signature, %{
        system_id: system.id,
        eve_id: "AAA-111",
        character_eve_id: character.eve_id,
        name: "Unstable Wormhole",
        kind: "Cosmic Signature",
        group: "Wormhole",
        type: "K162"
      })

    %{user: user, character: character, map: map, system: system, signature: signature}
  end

  test "rejects a stale snapshot atomically without applying changes", context do
    stale_base =
      context.system.id
      |> MapSystemSignature.by_system_id!()
      |> SignatureSnapshot.current()
      |> put_in([Access.at(0), "name"], "Changed in another client")

    assert :stale =
             SignaturesImpl.reconcile_signatures(
               context.map.id,
               reconciliation_params(context, %{
                 base_signatures: stale_base,
                 added_signatures: [
                   signature_dto(%{
                     "eve_id" => "BBB-222",
                     "character_eve_id" => context.character.eve_id,
                     "name" => "New signature"
                   })
                 ]
               })
             )

    assert [%{id: id, eve_id: "AAA-111", name: "Unstable Wormhole"}] =
             MapSystemSignature.by_system_id!(context.system.id)

    assert id == context.signature.id
  end

  test "applies a matching snapshot and returns locked removal baselines", context do
    updated_signature =
      Factory.insert(:map_system_signature, %{
        system_id: context.system.id,
        eve_id: "BBB-222",
        character_eve_id: context.character.eve_id,
        name: "Old name",
        kind: "Cosmic Signature",
        group: "Gas Site"
      })

    current = MapSystemSignature.by_system_id!(context.system.id)
    base = SignatureSnapshot.current(current)

    removal = signature_dto(context.signature)
    update = signature_dto(updated_signature, %{"name" => "Updated name"})

    assert {:applied, %{"AAA-111" => baseline}} =
             SignaturesImpl.reconcile_signatures(
               context.map.id,
               reconciliation_params(context, %{
                 base_signatures: base,
                 updated_signatures: [update],
                 removed_signatures: [removal]
               })
             )

    assert baseline.id == context.signature.id
    assert baseline.state.eve_id == "AAA-111"

    signatures = MapSystemSignature.by_system_id!(context.system.id)
    assert Enum.find(signatures, &(&1.eve_id == "AAA-111")).id == context.signature.id
    assert Enum.find(signatures, &(&1.eve_id == "BBB-222")).name == "Updated name"
  end

  test "rejects missing or malformed guarded snapshots without changes", context do
    update = signature_dto(context.signature, %{"name" => "Must not apply"})
    params = reconciliation_params(context, %{updated_signatures: [update]})

    assert :stale = SignaturesImpl.reconcile_signatures(context.map.id, params)

    assert :stale =
             SignaturesImpl.reconcile_signatures(
               context.map.id,
               Map.put(params, :base_signatures, %{"not" => "a list"})
             )

    assert [%{name: "Unstable Wormhole"}] =
             MapSystemSignature.by_system_id!(context.system.id)
  end

  test "rolls back earlier creates when a later create is invalid", context do
    base =
      context.system.id
      |> MapSystemSignature.by_system_id!()
      |> SignatureSnapshot.current()

    valid =
      signature_dto(%{
        "eve_id" => "BBB-222",
        "character_eve_id" => context.character.eve_id,
        "name" => "Would otherwise persist"
      })

    invalid = Map.put(valid, "eve_id", nil)

    assert {:error, _reason} =
             SignaturesImpl.reconcile_signatures(
               context.map.id,
               reconciliation_params(context, %{
                 base_signatures: base,
                 added_signatures: [valid, invalid]
               })
             )

    assert [%{eve_id: "AAA-111", name: "Unstable Wormhole"}] =
             MapSystemSignature.by_system_id!(context.system.id)
  end

  test "system lock ordering is deterministic and transaction errors are normalized" do
    high = "ffffffff-ffff-ffff-ffff-ffffffffffff"
    low = "00000000-0000-0000-0000-000000000001"

    assert [^low, ^high] =
             SignaturesImpl.deterministic_system_lock_order([high, low, high, nil])

    assert {:exception, RuntimeError, "boom"} =
             SignaturesImpl.normalize_transaction_error(%RuntimeError{message: "boom"})
  end

  defp reconciliation_params(context, overrides) do
    Map.merge(
      %{
        solar_system_id: context.system.solar_system_id,
        character_id: context.character.id,
        user_id: context.user.id,
        delete_connection_with_sigs: false,
        added_signatures: [],
        updated_signatures: [],
        removed_signatures: [],
        pending_eve_ids: MapSet.new()
      },
      overrides
    )
  end

  defp signature_dto(signature, overrides \\ %{}) do
    values = %{
      "eve_id" => field(signature, :eve_id),
      "character_eve_id" => field(signature, :character_eve_id),
      "name" => field(signature, :name),
      "temporary_name" => field(signature, :temporary_name),
      "description" => field(signature, :description),
      "kind" => field(signature, :kind) || "Cosmic Signature",
      "group" => field(signature, :group) || "Unknown",
      "type" => field(signature, :type),
      "custom_info" => field(signature, :custom_info)
    }

    Map.merge(values, overrides)
  end

  defp field(value, key), do: Map.get(value, key, Map.get(value, Atom.to_string(key)))
end

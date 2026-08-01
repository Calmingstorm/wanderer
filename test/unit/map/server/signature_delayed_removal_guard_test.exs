defmodule WandererApp.Map.Server.SignatureDelayedRemovalGuardTest do
  use WandererApp.DataCase, async: false

  alias WandererApp.Api.MapSystemSignature
  alias WandererApp.Map.Server.SignaturesImpl
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

  test "stale delayed removal cannot delete a signature updated by another client", context do
    baseline =
      SignaturesImpl.removal_baseline(context.map.id, context.system.solar_system_id, "AAA-111")

    assert {:ok, updated} =
             MapSystemSignature.update(context.signature, %{
               name: context.signature.name,
               update_forced_at: DateTime.utc_now()
             })

    assert updated.updated_at != context.signature.updated_at

    assert :stale =
             guarded_remove(context, baseline)

    assert [%{id: id, eve_id: "AAA-111"}] = MapSystemSignature.by_system_id!(context.system.id)
    assert id == context.signature.id
  end

  test "stale delayed removal cannot delete an indistinguishable recreated signature", context do
    baseline =
      SignaturesImpl.removal_baseline(context.map.id, context.system.solar_system_id, "AAA-111")

    MapSystemSignature.destroy!(context.signature)

    recreated =
      Factory.insert(:map_system_signature, %{
        system_id: context.system.id,
        eve_id: "AAA-111",
        character_eve_id: context.character.eve_id,
        name: "Unstable Wormhole",
        kind: "Cosmic Signature",
        group: "Wormhole",
        type: "K162"
      })

    refute recreated.id == context.signature.id
    assert :stale = guarded_remove(context, baseline)
    assert [%{id: id}] = MapSystemSignature.by_system_id!(context.system.id)
    assert id == recreated.id
  end

  defp guarded_remove(context, baseline) do
    SignaturesImpl.remove_signature_if_unchanged(context.map.id, %{
      solar_system_id: context.system.solar_system_id,
      character_id: context.character.id,
      user_id: context.user.id,
      delete_connection_with_sigs: false,
      signature: %{
        "eve_id" => "AAA-111",
        "character_eve_id" => context.character.eve_id,
        "name" => "Unstable Wormhole",
        "temporary_name" => nil,
        "description" => "A test signature",
        "kind" => "Cosmic Signature",
        "group" => "Wormhole",
        "type" => "K162",
        "custom_info" => nil
      },
      baseline: baseline
    })
  end
end

defmodule WandererAppWeb.MapSignaturesReconciliationDeletionPolicyTest do
  use ExUnit.Case, async: true

  alias WandererAppWeb.MapSignaturesEventHandler

  test "scanner synchronization keeps connections unless explicitly requested" do
    settings = %{settings: Jason.encode!(%{"delete_connection_with_sigs" => true})}
    permissions = %{delete_connection: true}

    refute MapSignaturesEventHandler.delete_connections_for_removal?(false, settings, permissions)
    assert MapSignaturesEventHandler.delete_connections_for_removal?(true, settings, permissions)
  end

  test "explicit deletion still requires current connection-delete permission" do
    settings = %{settings: Jason.encode!(%{"delete_connection_with_sigs" => true})}

    refute MapSignaturesEventHandler.delete_connections_for_removal?(true, settings, %{delete_connection: false})
  end

  test "legacy manual deletion may use the saved preference but remains permission-gated" do
    enabled = %{settings: Jason.encode!(%{"delete_connection_with_sigs" => true})}
    disabled = %{settings: Jason.encode!(%{"delete_connection_with_sigs" => false})}

    assert MapSignaturesEventHandler.delete_connections_for_removal?(
             :use_user_setting,
             enabled,
             %{delete_connection: true}
           )

    refute MapSignaturesEventHandler.delete_connections_for_removal?(
             :use_user_setting,
             disabled,
             %{delete_connection: true}
           )
  end


  test "canonical snapshots accept a matching base and reject stale bases" do
    current = [
      %{
        eve_id: "AAA-111",
        group: "Wormhole",
        kind: "Cosmic Signature",
        name: "Unstable Wormhole",
        type: "K162",
        description: nil,
        custom_info: ~s({"mass_status":1}),
        temporary_name: nil,
        character_eve_id: "42",
        linked_system_id: 31_000_002
      }
    ]

    canonical = MapSignaturesEventHandler.canonical_signature_snapshot(current)
    assert MapSignaturesEventHandler.snapshots_match?(canonical, canonical)

    stale = put_in(canonical, [Access.at(0), "name"], "Changed elsewhere")
    refute MapSignaturesEventHandler.snapshots_match?(stale, canonical)
  end

  test "pending removals are isolated by system and superseded tokens are stale" do
    old_token = make_ref()
    new_token = make_ref()
    first_key = MapSignaturesEventHandler.removal_key("31000001", "AAA-111")
    other_key = MapSignaturesEventHandler.removal_key("31000002", "AAA-111")

    pending = %{
      first_key => %{token: new_token, delete_connections: false},
      other_key => %{token: old_token, delete_connections: true}
    }

    assert :stale = MapSignaturesEventHandler.pending_removal_matches?(pending, first_key, old_token)
    assert {:ok, %{delete_connections: false}} =
             MapSignaturesEventHandler.pending_removal_matches?(pending, first_key, new_token)

    remaining = MapSignaturesEventHandler.cancel_pending_removals(pending, 31_000_001, ["AAA-111"])
    refute Map.has_key?(remaining, first_key)
    assert Map.has_key?(remaining, other_key)
  end
end

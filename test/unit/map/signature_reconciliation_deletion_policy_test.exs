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
end

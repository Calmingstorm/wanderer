defmodule WandererApp.Repo.TransactionNotificationsTest do
  use WandererApp.DataCase, async: false

  alias WandererApp.Repo.TransactionNotifications

  test "flushes notifications only after the outer transaction commits" do
    test_process = self()

    assert {:ok, :committed} =
             TransactionNotifications.transaction(fn ->
               TransactionNotifications.defer(fn -> send(test_process, :outer_notification) end)

               assert {:ok, :nested} =
                        TransactionNotifications.transaction(fn ->
                          TransactionNotifications.defer(fn ->
                            send(test_process, :nested_notification)
                          end)

                          refute_received :outer_notification
                          refute_received :nested_notification
                          :nested
                        end)

               refute_received :outer_notification
               refute_received :nested_notification
               :committed
             end)

    assert_receive :outer_notification
    assert_receive :nested_notification
  end

  test "discards notifications when the transaction rolls back" do
    test_process = self()

    assert {:error, :rolled_back} =
             TransactionNotifications.transaction(fn ->
               TransactionNotifications.defer(fn -> send(test_process, :should_not_escape) end)
               WandererApp.Repo.rollback(:rolled_back)
             end)

    refute_receive :should_not_escape, 50
  end
end

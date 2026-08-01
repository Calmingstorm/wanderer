defmodule WandererApp.Repo.TransactionNotifications do
  @moduledoc false

  require Logger

  @notifications_key {__MODULE__, :notifications}

  def transaction(fun) when is_function(fun, 0) do
    case Process.get(@notifications_key) do
      nil -> outer_transaction(fun)
      notifications -> nested_transaction(fun, notifications)
    end
  end

  def defer(fun) when is_function(fun, 0) do
    case Process.get(@notifications_key) do
      nil ->
        fun.()

      notifications ->
        Process.put(@notifications_key, [fun | notifications])
        :ok
    end
  end

  def active?, do: not is_nil(Process.get(@notifications_key))

  defp outer_transaction(fun) do
    Process.put(@notifications_key, [])

    try do
      result = WandererApp.Repo.transaction(fun)
      notifications = Process.get(@notifications_key, [])
      Process.delete(@notifications_key)

      case result do
        {:ok, _value} -> flush(Enum.reverse(notifications))
        {:error, _reason} -> :ok
      end

      result
    catch
      kind, reason ->
        Process.delete(@notifications_key)
        :erlang.raise(kind, reason, __STACKTRACE__)
    end
  end

  defp nested_transaction(fun, notifications_before) do
    try do
      result = WandererApp.Repo.transaction(fun)

      if match?({:error, _reason}, result) do
        Process.put(@notifications_key, notifications_before)
      end

      result
    catch
      kind, reason ->
        Process.put(@notifications_key, notifications_before)
        :erlang.raise(kind, reason, __STACKTRACE__)
    end
  end

  defp flush(notifications) do
    Enum.each(notifications, fn notification ->
      try do
        notification.()
      rescue
        error ->
          Logger.error("Post-commit notification failed: #{Exception.message(error)}")
      catch
        kind, reason ->
          Logger.error("Post-commit notification failed: #{inspect({kind, reason})}")
      end
    end)
  end
end

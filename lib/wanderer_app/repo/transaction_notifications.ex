defmodule WandererApp.Repo.TransactionNotifications do
  @moduledoc false

  require Logger

  @notifications_key {__MODULE__, :notifications}
  @transaction_resource WandererApp.Api.MapSystemSignature

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
      result =
        Ash.transact(@transaction_resource, fun, return_notifications?: true)

      notifications = Process.get(@notifications_key, [])
      Process.delete(@notifications_key)

      case result do
        {:ok, _value, ash_notifications} ->
          flush_ash(ash_notifications)
          flush(Enum.reverse(notifications))

        {:error, _reason} ->
          :ok
      end

      normalize_result(result)
    catch
      kind, reason ->
        Process.delete(@notifications_key)
        :erlang.raise(kind, reason, __STACKTRACE__)
    end
  end

  defp nested_transaction(fun, notifications_before) do
    try do
      result =
        Ash.transact(@transaction_resource, fun, return_notifications?: true)

      case result do
        {:ok, _value, ash_notifications} ->
          defer(fn -> flush_ash(ash_notifications) end)

        {:error, _reason} ->
          Process.put(@notifications_key, notifications_before)
      end

      normalize_result(result)
    catch
      kind, reason ->
        Process.put(@notifications_key, notifications_before)
        :erlang.raise(kind, reason, __STACKTRACE__)
    end
  end

  defp normalize_result({:ok, value, _notifications}), do: {:ok, value}

  defp normalize_result(
         {:error, %Ash.Error.Unknown.UnknownError{error: "unknown error: :" <> atom_name}} =
           result
       ) do
    try do
      {:error, String.to_existing_atom(atom_name)}
    rescue
      ArgumentError -> result
    end
  end

  defp normalize_result(result), do: result

  defp flush_ash(notifications) do
    notifications
    |> Ash.Notifier.notify()
    |> case do
      [] ->
        :ok

      remaining ->
        Logger.warning("Post-commit Ash notifications were not delivered: #{inspect(remaining)}")
    end
  rescue
    error ->
      Logger.error("Post-commit Ash notification failed: #{Exception.message(error)}")
  catch
    kind, reason ->
      Logger.error("Post-commit Ash notification failed: #{inspect({kind, reason})}")
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

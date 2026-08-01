defmodule WandererApp.Map.Server.SignatureSnapshot do
  @moduledoc false

  @fields [
    :eve_id,
    :group,
    :kind,
    :name,
    :type,
    :description,
    :custom_info,
    :temporary_name,
    :character_eve_id,
    :linked_system_id,
    :deleted
  ]

  def current(signatures, pending_eve_ids \\ MapSet.new()) do
    signatures
    |> Enum.map(fn signature ->
      eve_id = field(signature, :eve_id)

      signature
      |> canonical_signature()
      |> Map.put(
        "deleted",
        MapSet.member?(pending_eve_ids, eve_id) or field(signature, :deleted) == true
      )
    end)
    |> sort()
  end

  def client(snapshot) when is_list(snapshot) do
    if Enum.all?(snapshot, &is_map/1) do
      snapshot
      |> Enum.map(&canonical_signature/1)
      |> sort()
    else
      :invalid
    end
  end

  def client(_snapshot), do: :invalid

  def matches?(expected, current), do: client(expected) == current

  defp canonical_signature(signature) do
    Map.new(@fields, fn
      :custom_info -> {"custom_info", canonical_custom_info(field(signature, :custom_info))}
      :deleted -> {"deleted", field(signature, :deleted) == true}
      key -> {Atom.to_string(key), field(signature, key)}
    end)
  end

  defp sort(signatures), do: Enum.sort_by(signatures, & &1["eve_id"])

  defp canonical_custom_info(nil), do: nil
  defp canonical_custom_info(""), do: nil
  defp canonical_custom_info(value) when is_map(value) or is_list(value), do: value

  defp canonical_custom_info(value) when is_binary(value) do
    case Jason.decode(value) do
      {:ok, decoded} -> decoded
      _ -> value
    end
  end

  defp canonical_custom_info(value), do: value

  defp field(map, key) when is_map(map),
    do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
end

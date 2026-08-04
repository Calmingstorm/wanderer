defmodule WandererApp.Map.LocalRouteBuilder do
  @moduledoc """
  In-process route calculation used when `CUSTOM_ROUTE_BASE_URL` is not set.

  The graph comes from the same solar-system and stargate data already loaded by
  Wanderer. Map, Thera, and Turnur links are applied to a request as additional
  edges, preserving the route widget's custom-chain behavior without requiring
  a separate route-builder service.
  """

  @graph_cache_key :local_route_builder_graph
  @graph_ttl :timer.hours(24)
  @high_security_threshold 0.45
  @security_penalty 50_000

  def routes(hubs, origin, params) do
    with {:ok, graph} <- graph() do
      {:ok, routes_with_graph(graph, hubs, origin, params)}
    end
  end

  def find_closest(payload) do
    with {:ok, graph} <- graph() do
      {:ok, find_closest_with_graph(graph, payload)}
    end
  end

  @doc false
  def build_graph(systems, jumps) do
    security =
      Map.new(systems, fn system ->
        {system.solar_system_id, normalize_security(system.security)}
      end)

    neighbors =
      systems
      |> Map.new(fn system -> {system.solar_system_id, MapSet.new()} end)
      |> add_jumps(jumps)

    %{neighbors: neighbors, security: security}
  end

  @doc false
  def routes_with_graph(graph, hubs, origin, params) do
    origin = normalize_integer(origin)
    destinations = Enum.map(hubs, &normalize_integer/1)
    prepared_graph = prepare_graph(graph, value(params, :connections, []))
    avoided = normalize_id_set(value(params, :avoid, []))
    flag = normalize_flag(value(params, :flag, "shortest"))

    paths = find_paths(prepared_graph, origin, destinations, flag, avoided)

    Enum.map(destinations, fn destination ->
      path = Map.get(paths, destination, [])

      %{
        origin: origin,
        destination: destination,
        systems: path,
        success: path != []
      }
    end)
  end

  @doc false
  def find_closest_with_graph(graph, payload) do
    origin = normalize_integer(value(payload, :origin))
    destinations = value(payload, :destinations, []) |> Enum.map(&normalize_integer/1)
    prepared_graph = prepare_graph(graph, value(payload, :connections, []))
    avoided = normalize_id_set(value(payload, :avoid, []))
    flag = normalize_flag(value(payload, :flag, "shortest"))
    count = normalize_count(value(payload, :count, 1), length(destinations))

    prepared_graph
    |> find_paths(origin, destinations, flag, avoided, count)
    |> Enum.map(fn {destination, path} ->
      %{
        origin: origin,
        destination: destination,
        systems: path,
        success: true
      }
    end)
    |> Enum.sort_by(fn route -> {length(route.systems), route.destination} end)
    |> Enum.take(count)
  end

  defp graph do
    case WandererApp.Cache.lookup(@graph_cache_key) do
      {:ok, graph} when is_map(graph) ->
        {:ok, graph}

      _ ->
        with {:ok, systems} when systems != [] <- WandererApp.Api.MapSolarSystem.read(),
             {:ok, jumps} when jumps != [] <- WandererApp.CachedInfo.get_solar_system_jumps() do
          graph = build_graph(systems, jumps)
          :ok = WandererApp.Cache.insert(@graph_cache_key, graph, ttl: @graph_ttl)
          {:ok, graph}
        else
          {:ok, []} -> {:error, :route_graph_unavailable}
          error -> error
        end
    end
  end

  defp add_jumps(neighbors, jumps) do
    Enum.reduce(jumps, neighbors, fn jump, acc ->
      add_edge(acc, jump.from_solar_system_id, jump.to_solar_system_id)
    end)
  end

  defp prepare_graph(graph, connections) do
    neighbors =
      connections
      |> normalize_connections()
      |> Enum.reduce(graph.neighbors, fn connection, acc ->
        case parse_connection(connection) do
          {from, to}
          when is_integer(from) and is_integer(to) and
                 is_map_key(graph.neighbors, from) and is_map_key(graph.neighbors, to) ->
            add_edge(acc, from, to)

          _ ->
            acc
        end
      end)

    %{graph | neighbors: neighbors}
  end

  defp normalize_connections(connections) when is_list(connections), do: connections
  defp normalize_connections(_), do: []

  defp add_edge(neighbors, from, to) when is_integer(from) and is_integer(to) do
    neighbors
    |> Map.update(from, MapSet.new([to]), &MapSet.put(&1, to))
    |> Map.update(to, MapSet.new([from]), &MapSet.put(&1, from))
  end

  defp parse_connection(connection) when is_binary(connection) do
    case String.split(connection, "|", parts: 2) do
      [from, to] -> {normalize_integer(from), normalize_integer(to)}
      _ -> nil
    end
  end

  defp parse_connection([from, to]), do: {normalize_integer(from), normalize_integer(to)}
  defp parse_connection({from, to}), do: {normalize_integer(from), normalize_integer(to)}

  defp parse_connection(%{first: from, second: to}),
    do: {normalize_integer(from), normalize_integer(to)}

  defp parse_connection(%{"first" => from, "second" => to}),
    do: {normalize_integer(from), normalize_integer(to)}

  defp parse_connection(_), do: nil

  defp find_paths(graph, origin, destinations, flag, avoided, count \\ nil) do
    valid_destinations =
      destinations
      |> Enum.filter(&is_integer/1)
      |> Enum.filter(&Map.has_key?(graph.neighbors, &1))
      |> MapSet.new()
      |> MapSet.difference(avoided)

    cond do
      not is_integer(origin) ->
        %{}

      not Map.has_key?(graph.neighbors, origin) ->
        %{}

      MapSet.member?(avoided, origin) ->
        %{}

      MapSet.size(valid_destinations) == 0 ->
        %{}

      true ->
        target_count =
          min(count || MapSet.size(valid_destinations), MapSet.size(valid_destinations))

        {_distances, previous, found} =
          dijkstra(
            graph,
            origin,
            valid_destinations,
            flag,
            avoided,
            target_count
          )

        Map.new(found, fn destination ->
          {destination, build_path(previous, origin, destination)}
        end)
    end
  end

  defp dijkstra(graph, origin, targets, flag, avoided, target_count) do
    queue = :gb_sets.singleton({0, origin})

    do_dijkstra(
      graph,
      queue,
      %{origin => 0},
      %{},
      MapSet.new(),
      targets,
      MapSet.new(),
      flag,
      avoided,
      target_count
    )
  end

  defp do_dijkstra(
         graph,
         queue,
         distances,
         previous,
         visited,
         targets,
         found,
         flag,
         avoided,
         target_count
       ) do
    cond do
      :gb_sets.is_empty(queue) or MapSet.size(found) >= target_count ->
        {distances, previous, found}

      true ->
        {{distance, system}, queue} = :gb_sets.take_smallest(queue)

        if MapSet.member?(visited, system) do
          do_dijkstra(
            graph,
            queue,
            distances,
            previous,
            visited,
            targets,
            found,
            flag,
            avoided,
            target_count
          )
        else
          visited = MapSet.put(visited, system)
          found = if MapSet.member?(targets, system), do: MapSet.put(found, system), else: found

          {queue, distances, previous} =
            graph.neighbors
            |> Map.get(system, MapSet.new())
            |> Enum.reject(&MapSet.member?(avoided, &1))
            |> Enum.reduce({queue, distances, previous}, fn neighbor,
                                                            {next_queue, next_distances,
                                                             next_previous} ->
              if MapSet.member?(visited, neighbor) do
                {next_queue, next_distances, next_previous}
              else
                next_distance = distance + edge_cost(graph, neighbor, flag)

                if next_distance < Map.get(next_distances, neighbor, :infinity) do
                  {
                    :gb_sets.add({next_distance, neighbor}, next_queue),
                    Map.put(next_distances, neighbor, next_distance),
                    Map.put(next_previous, neighbor, system)
                  }
                else
                  {next_queue, next_distances, next_previous}
                end
              end
            end)

          do_dijkstra(
            graph,
            queue,
            distances,
            previous,
            visited,
            targets,
            found,
            flag,
            avoided,
            target_count
          )
        end
    end
  end

  defp edge_cost(_graph, _system, :shortest), do: 1

  defp edge_cost(graph, system, :secure) do
    if Map.get(graph.security, system, -1.0) < @high_security_threshold,
      do: @security_penalty,
      else: 1
  end

  defp edge_cost(graph, system, :insecure) do
    if Map.get(graph.security, system, -1.0) >= @high_security_threshold,
      do: @security_penalty,
      else: 1
  end

  defp build_path(_previous, origin, origin), do: [origin]

  defp build_path(previous, origin, destination) do
    do_build_path(previous, origin, destination, [], MapSet.new())
  end

  defp do_build_path(previous, origin, current, path, seen) do
    cond do
      current == origin ->
        [origin | path]

      MapSet.member?(seen, current) ->
        []

      true ->
        case Map.fetch(previous, current) do
          {:ok, parent} ->
            do_build_path(previous, origin, parent, [current | path], MapSet.put(seen, current))

          :error ->
            []
        end
    end
  end

  defp normalize_id_set(ids) do
    ids
    |> List.wrap()
    |> Enum.map(&normalize_integer/1)
    |> Enum.filter(&is_integer/1)
    |> MapSet.new()
  end

  defp normalize_integer(value) when is_integer(value), do: value

  defp normalize_integer(value) when is_binary(value) do
    case Integer.parse(value) do
      {integer, ""} -> integer
      _ -> nil
    end
  end

  defp normalize_integer(_), do: nil

  defp normalize_security(value) when is_float(value), do: value
  defp normalize_security(value) when is_integer(value), do: value * 1.0

  defp normalize_security(value) when is_binary(value) do
    case Float.parse(value) do
      {security, _} -> security
      :error -> -1.0
    end
  end

  defp normalize_security(_), do: -1.0

  defp normalize_flag(:secure), do: :secure
  defp normalize_flag("secure"), do: :secure
  defp normalize_flag(:insecure), do: :insecure
  defp normalize_flag("insecure"), do: :insecure
  defp normalize_flag(_), do: :shortest

  defp normalize_count(value, maximum) when is_integer(value) and value > 0,
    do: min(value, maximum)

  defp normalize_count(_, maximum), do: min(1, maximum)

  defp value(map, key, default \\ nil) do
    Map.get(map, key, Map.get(map, Atom.to_string(key), default))
  end
end
defmodule WandererApp.Map.LocalRouteBuilderTest do
  use ExUnit.Case, async: true

  alias WandererApp.Map.LocalRouteBuilder

  defp system(id, security), do: %{solar_system_id: id, security: security}
  defp jump(from, to), do: %{from_solar_system_id: from, to_solar_system_id: to}

  setup do
    graph =
      LocalRouteBuilder.build_graph(
        [
          system(1, "0.9"),
          system(2, "0.8"),
          system(3, "0.2"),
          system(4, "0.9"),
          system(5, "-1.0")
        ],
        [jump(1, 2), jump(2, 4), jump(1, 3), jump(3, 4)]
      )

    %{graph: graph}
  end

  test "calculates routes to multiple hubs", %{graph: graph} do
    assert [
             %{origin: 1, destination: 2, systems: [1, 2], success: true},
             %{origin: 1, destination: 4, systems: [1, 2, 4], success: true}
           ] = LocalRouteBuilder.routes_with_graph(graph, [2, 4], 1, %{flag: "shortest"})
  end

  test "uses request-scoped wormhole connections", %{graph: graph} do
    assert [%{systems: [5, 2, 4], success: true}] =
             LocalRouteBuilder.routes_with_graph(graph, [4], 5, %{
               flag: "shortest",
               connections: ["5|2"]
             })
  end

  test "ignores malformed and unknown additional connections", %{graph: graph} do
    assert [%{systems: [], success: false}] =
             LocalRouteBuilder.routes_with_graph(graph, [5], 1, %{
               flag: "shortest",
               connections: "1|5"
             })

    assert [%{systems: [], success: false}] =
             LocalRouteBuilder.routes_with_graph(graph, [5], 1, %{
               flag: "shortest",
               connections: ["1|999", "999|5"]
             })
  end

  test "respects avoided systems", %{graph: graph} do
    assert [%{systems: [1, 3, 4], success: true}] =
             LocalRouteBuilder.routes_with_graph(graph, [4], 1, %{
               flag: "shortest",
               avoid: [2]
             })
  end

  test "secure and insecure preferences choose different equal-hop paths", %{graph: graph} do
    assert [%{systems: [1, 2, 4]}] =
             LocalRouteBuilder.routes_with_graph(graph, [4], 1, %{flag: "secure"})

    assert [%{systems: [1, 3, 4]}] =
             LocalRouteBuilder.routes_with_graph(graph, [4], 1, %{flag: "insecure"})
  end

  test "finds the requested number of closest weighted destinations", %{graph: graph} do
    assert [
             %{destination: 2, systems: [1, 2]},
             %{destination: 4, systems: [1, 2, 4]}
           ] =
             LocalRouteBuilder.find_closest_with_graph(graph, %{
               origin: 1,
               destinations: [2, 3, 4],
               flag: "secure",
               count: 2
             })
  end

  test "returns an explicit unsuccessful result for an unreachable destination", %{graph: graph} do
    assert [%{destination: 5, systems: [], success: false}] =
             LocalRouteBuilder.routes_with_graph(graph, [5], 1, %{flag: "shortest"})
  end

  test "finds and limits closest destinations", %{graph: graph} do
    assert [%{destination: 2, systems: [1, 2], success: true}] =
             LocalRouteBuilder.find_closest_with_graph(graph, %{
               origin: 1,
               destinations: [4, 2],
               flag: "shortest",
               count: 1
             })
  end
end
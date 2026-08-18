defmodule WandererApp.EnvTest do
  use ExUnit.Case, async: false

  setup do
    original = Application.get_env(:wanderer_app, :custom_route_base_url)

    on_exit(fn ->
      if is_nil(original) do
        Application.delete_env(:wanderer_app, :custom_route_base_url)
      else
        Application.put_env(:wanderer_app, :custom_route_base_url, original)
      end
    end)
  end

  test "treats missing and blank custom route URLs as disabled" do
    Application.delete_env(:wanderer_app, :custom_route_base_url)
    assert WandererApp.Env.custom_route_base_url() == nil

    Application.put_env(:wanderer_app, :custom_route_base_url, "   ")
    assert WandererApp.Env.custom_route_base_url() == nil
  end

  test "normalizes a configured custom route URL" do
    Application.put_env(:wanderer_app, :custom_route_base_url, " https://routes.example.test/// ")
    assert WandererApp.Env.custom_route_base_url() == "https://routes.example.test"
  end
end

"""
Unit tests for Provider Registry.
"""
import os
import pytest
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from provider_registry import (
    ProviderSpec,
    ProviderInstance,
    ProviderRegistry,
    PROVIDERS,
)


# ── ProviderSpec Tests ──

def test_provider_spec_creation():
    spec = ProviderSpec(
        name="test_provider",
        display_name="Test Provider",
        default_api_base="https://api.test.com/v1",
        env_key="TEST_API_KEY",
        keywords=("test",),
        default_model="test-model",
    )
    assert spec.name == "test_provider"
    assert spec.display_name == "Test Provider"
    assert spec.route == "cloud"
    assert spec.is_gateway is False
    assert spec.supports_tool_use is False
    assert spec.default_temperature == 0.3


def test_provider_spec_immutable():
    spec = ProviderSpec(
        name="test",
        display_name="Test",
        default_api_base="https://api.test.com/v1",
    )
    with pytest.raises(AttributeError):
        spec.name = "changed"


# ── ProviderInstance Tests ──

def test_provider_instance_health_score_new():
    spec = ProviderSpec(name="test", display_name="Test", default_api_base="http://test")
    inst = ProviderInstance(spec=spec, is_available=True)
    # New instance with no calls → 0.5
    assert inst.health_score == 0.5


def test_provider_instance_health_score_unavailable():
    spec = ProviderSpec(name="test", display_name="Test", default_api_base="http://test")
    inst = ProviderInstance(spec=spec, is_available=False)
    assert inst.health_score == 0.0


def test_provider_instance_health_tracking():
    spec = ProviderSpec(name="test", display_name="Test", default_api_base="http://test")
    inst = ProviderInstance(spec=spec, is_available=True)

    # Record successes
    inst.record_success()
    inst.record_success()
    inst.record_success()
    assert inst.call_count == 3
    assert inst.error_count == 0
    assert inst.health_score == 1.0

    # Record error
    inst.record_error("timeout")
    assert inst.call_count == 4
    assert inst.error_count == 1
    assert inst.health_score < 1.0
    assert inst.last_error == "timeout"


def test_provider_instance_to_dict():
    spec = ProviderSpec(
        name="deepseek",
        display_name="DeepSeek",
        default_api_base="https://api.deepseek.com/v1",
        supports_tool_use=True,
    )
    inst = ProviderInstance(
        spec=spec,
        api_key="sk-test",
        api_base="https://api.deepseek.com/v1",
        model="deepseek-chat",
        is_available=True,
    )
    d = inst.to_dict()

    assert d["name"] == "deepseek"
    assert d["display_name"] == "DeepSeek"
    assert d["key_configured"] is True
    assert d["is_available"] is True
    assert d["supports_tool_use"] is True
    assert d["health_score"] == 0.5  # new, no calls


# ── ProviderRegistry Tests ──

def _make_test_specs() -> list[ProviderSpec]:
    """Create a minimal set of specs for testing."""
    return [
        ProviderSpec(
            name="local",
            display_name="Local",
            default_api_base="http://localhost:11434/v1",
            env_key="TEST_LOCAL_KEY",
            keywords=("llama", "qwen"),
            route="local",
            default_model="qwen3:8b",
        ),
        ProviderSpec(
            name="cloud_a",
            display_name="Cloud A",
            default_api_base="https://api.cloud-a.com/v1",
            env_key="TEST_CLOUD_A_KEY",
            keywords=("cloud-a",),
            default_model="cloud-a-chat",
        ),
        ProviderSpec(
            name="cloud_b",
            display_name="Cloud B",
            default_api_base="https://api.cloud-b.com/v1",
            env_key="TEST_CLOUD_B_KEY",
            keywords=("cloud-b",),
            default_model="cloud-b-model",
            is_gateway=True,
        ),
    ]


def test_registry_initialize(monkeypatch):
    """Test registry initialization from env vars."""
    monkeypatch.setenv("TEST_CLOUD_A_KEY", "sk-test-a")
    monkeypatch.setenv("LLM_CLOUD_PROVIDER_ORDER", "cloud_a,cloud_b")

    registry = ProviderRegistry(specs=_make_test_specs())
    registry.initialize()

    # Local should be available (default key)
    local = registry.get("local")
    assert local is not None
    assert local.is_available is True

    # Cloud A should be available (env key set)
    cloud_a = registry.get("cloud_a")
    assert cloud_a is not None
    assert cloud_a.is_available is True
    assert cloud_a.api_key == "sk-test-a"

    # Cloud B should not be available (no key)
    cloud_b = registry.get("cloud_b")
    assert cloud_b is not None
    assert cloud_b.is_available is False


def test_registry_resolve_by_keyword(monkeypatch):
    """Test model name keyword resolution."""
    monkeypatch.setenv("TEST_CLOUD_A_KEY", "sk-a")

    registry = ProviderRegistry(specs=_make_test_specs())
    registry.initialize()

    # "cloud-a-chat" should match cloud_a by keyword
    inst = registry.resolve("cloud-a-chat")
    assert inst is not None
    assert inst.spec.name == "cloud_a"

    # "llama-3" should match local
    inst = registry.resolve("llama-3")
    assert inst is not None
    assert inst.spec.name == "local"


def test_registry_resolve_by_name(monkeypatch):
    """Test direct name resolution."""
    monkeypatch.setenv("TEST_CLOUD_A_KEY", "sk-a")

    registry = ProviderRegistry(specs=_make_test_specs())
    registry.initialize()

    inst = registry.resolve("cloud_a")
    assert inst is not None
    assert inst.spec.name == "cloud_a"


def test_registry_resolve_gateway_fallback(monkeypatch):
    """Test gateway fallback for unknown models."""
    monkeypatch.setenv("TEST_CLOUD_B_KEY", "sk-b")  # Gateway is available

    registry = ProviderRegistry(specs=_make_test_specs())
    registry.initialize()

    # Unknown model should fall back to gateway
    inst = registry.resolve("some-unknown-model-xyz")
    assert inst is not None
    assert inst.spec.is_gateway is True


def test_registry_resolve_no_match(monkeypatch):
    """Test when no provider matches and none available."""
    # Don't set any env keys
    registry = ProviderRegistry(specs=[
        ProviderSpec(
            name="only_cloud",
            display_name="Only Cloud",
            default_api_base="https://api.only.com/v1",
            env_key="NONEXISTENT_KEY_12345",
            keywords=("only",),
        ),
    ])
    registry.initialize()

    # Local fallback always available
    inst = registry.resolve("totally-unknown")
    # Since only_cloud has no key, it's unavailable
    assert inst is None  # No available provider


def test_registry_cloud_providers(monkeypatch):
    """Test getting cloud providers in priority order."""
    monkeypatch.setenv("TEST_CLOUD_A_KEY", "sk-a")
    monkeypatch.setenv("TEST_CLOUD_B_KEY", "sk-b")
    monkeypatch.setenv("LLM_CLOUD_PROVIDER_ORDER", "cloud_b,cloud_a")

    registry = ProviderRegistry(specs=_make_test_specs())
    registry.initialize()

    providers = registry.get_cloud_providers()
    assert len(providers) == 2
    assert providers[0].spec.name == "cloud_b"  # priority order
    assert providers[1].spec.name == "cloud_a"


def test_registry_local_provider():
    """Test getting local provider."""
    registry = ProviderRegistry(specs=_make_test_specs())
    registry.initialize()

    local = registry.get_local_provider()
    assert local is not None
    assert local.spec.route == "local"


def test_registry_model_overrides():
    """Test per-model parameter overrides."""
    specs = [
        ProviderSpec(
            name="test_provider",
            display_name="Test",
            default_api_base="http://test",
            model_overrides=(
                ("reasoning-model", {"temperature": 1.0, "max_tokens": 8192}),
                ("fast-model", {"temperature": 0.1}),
            ),
        ),
    ]
    registry = ProviderRegistry(specs=specs)
    registry.initialize()

    overrides = registry.get_model_overrides("test_provider", "reasoning-model-v2")
    assert overrides == {"temperature": 1.0, "max_tokens": 8192}

    overrides = registry.get_model_overrides("test_provider", "fast-model")
    assert overrides == {"temperature": 0.1}

    overrides = registry.get_model_overrides("test_provider", "normal-model")
    assert overrides == {}


def test_registry_list_all():
    """Test listing all providers."""
    registry = ProviderRegistry(specs=_make_test_specs())
    registry.initialize()

    all_providers = registry.list_all()
    assert len(all_providers) == 3
    assert all(isinstance(p, dict) for p in all_providers)
    names = {p["name"] for p in all_providers}
    assert "local" in names
    assert "cloud_a" in names
    assert "cloud_b" in names


def test_registry_describe():
    """Test registry description for diagnostics."""
    registry = ProviderRegistry(specs=_make_test_specs())
    registry.initialize()

    desc = registry.describe()
    assert desc["total_providers"] == 3
    assert isinstance(desc["available"], list)
    assert isinstance(desc["cloud_providers"], list)
    assert isinstance(desc["local_providers"], list)
    assert isinstance(desc["providers"], list)


# ── Default PROVIDERS validation ──

def test_default_providers_not_empty():
    """Ensure the default PROVIDERS list has entries."""
    assert len(PROVIDERS) > 0


def test_default_providers_unique_names():
    """Ensure all provider names are unique."""
    names = [p.name for p in PROVIDERS]
    assert len(names) == len(set(names)), f"Duplicate names: {names}"


def test_default_providers_have_required_fields():
    """Ensure all providers have name, display_name, default_api_base."""
    for p in PROVIDERS:
        assert p.name, f"Provider missing name"
        assert p.display_name, f"Provider {p.name} missing display_name"
        assert p.default_api_base, f"Provider {p.name} missing default_api_base"


def test_known_providers_present():
    """Spot check that key providers are registered."""
    names = {p.name for p in PROVIDERS}
    assert "deepseek" in names
    assert "dashscope" in names
    assert "openai" in names
    assert "anthropic" in names


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

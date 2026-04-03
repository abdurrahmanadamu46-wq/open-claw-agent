"""
Optional OpenTelemetry bridge for edge runtime spans.
"""

from __future__ import annotations

import logging
import os
from contextlib import nullcontext
from typing import Any


logger = logging.getLogger("edge_telemetry")


class _NoopSpan:
    def set_attribute(self, _key: str, _value: Any) -> None:
        return

    def __enter__(self) -> "_NoopSpan":
        return self

    def __exit__(self, *_args: Any) -> None:
        return


class _ManagedSpan:
    def __init__(self, ctx: Any) -> None:
        self._ctx = ctx
        self._span = None

    def __enter__(self) -> Any:
        self._span = self._ctx.__enter__()
        return self._span

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self._ctx.__exit__(exc_type, exc, tb)


class _NoopTracer:
    def start_span(self, _name: str) -> _NoopSpan:
        return _NoopSpan()


class _EdgeTracer:
    def __init__(self, tracer: Any) -> None:
        self._tracer = tracer

    def start_span(self, name: str) -> _ManagedSpan:
        return _ManagedSpan(self._tracer.start_as_current_span(name))


_tracer: _EdgeTracer | _NoopTracer | None = None


def get_tracer() -> _EdgeTracer | _NoopTracer:
    global _tracer
    if _tracer is not None:
        return _tracer
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        endpoint = str(os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://localhost:4318/v1/traces")).strip()
        headers = {}
        edge_token = str(os.getenv("EDGE_TOKEN", "")).strip()
        if edge_token:
            headers["Authorization"] = f"Bearer {edge_token}"
        provider = TracerProvider(
            resource=Resource.create(
                {
                    "service.name": "edge-runtime",
                    "service.version": str(os.getenv("EDGE_VERSION", "1.0.0-edge")),
                }
            )
        )
        provider.add_span_processor(
            BatchSpanProcessor(
                OTLPSpanExporter(endpoint=endpoint, headers=headers or None)
            )
        )
        trace.set_tracer_provider(provider)
        tracer = trace.get_tracer("edge-runtime")
        _tracer = _EdgeTracer(tracer)
        logger.info("[EdgeTelemetry] otel enabled endpoint=%s", endpoint)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[EdgeTelemetry] otel disabled, fallback noop: %s", exc)
        _tracer = _NoopTracer()
    return _tracer

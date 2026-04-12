import asyncio
import base64
import hashlib
import hmac
import importlib.util
import json
import os
import re
import secrets
import sys
import time
import urllib.parse
import uuid
from contextlib import asynccontextmanager
from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi import BackgroundTasks, Body, Depends, FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel, Field
from redis.asyncio import Redis

try:
    from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
except Exception:  # noqa: BLE001
    AsyncPostgresSaver = None  # type: ignore[assignment]

from anythingllm_embed import build_embed_snippet
from anythingllm_embed import ensure_anythingllm_workspace
from anythingllm_embed import fetch_anythingllm_health
from api_admin_crud import admin_router
from api_snapshot_audit import get_snapshot_audit_store
from auth_federation import extract_federated_identity
from auth_federation import build_authorization_url
from auth_federation import build_pkce_pair
from auth_federation import discover_provider_for_email
from auth_federation import exchange_authorization_code_for_tokens
from auth_federation import get_federation_store
from auth_federation import hydrate_provider_metadata
from auth_federation import resolve_or_provision_federated_user
from auth_federation import test_provider_configuration
from auth_federation import verify_federated_token
from auth_federation import verify_federated_token_response
from auth_oidc import get_oidc_provider
from auth_scim import build_resource_types as build_scim_resource_types
from auth_scim import build_schemas as build_scim_schemas
from auth_scim import build_service_provider_config as build_scim_service_provider_config
from auth_scim import create_scim_group
from auth_scim import create_scim_user
from auth_scim import delete_scim_group
from auth_scim import delete_scim_user
from auth_scim import get_scim_group
from auth_scim import get_scim_user
from auth_scim import list_scim_groups
from auth_scim import list_scim_users
from auth_scim import patch_scim_group
from auth_scim import patch_scim_user
from auth_scim import replace_scim_group
from auth_scim import replace_scim_user
from auth_scim import ScimConflictError
from auth_scim import ScimNotFoundError
from campaign_graph import CampaignGraphInput
from campaign_graph import simulate_campaign_graph
from campaign_graph import summarize_simulation_for_chat
from dragon_senate import app as dragon_graph
from dragon_senate import ainvoke_for_goal as _dragon_ainvoke_for_goal
from dragon_senate import competitor_analysis as dragon_competitor_analysis_node
from dragon_senate import competitor_formula_analyzer as dragon_competitor_formula_analyzer_node
from dragon_senate import dm_app as dm_graph
from dragon_senate import set_edge_delivery_hook
from dragon_senate import set_human_approval_hooks
from llm_router import RouteMeta
from llm_router import llm_router
from rbac_permission import ResourcePermission
from rbac_permission import ResourceScope
from rbac_permission import ResourceType
from rbac_permission import get_rbac_service
from resource_guard import require_resource_permission
from agent_model_registry import catalog as llm_model_catalog
from agent_model_registry import ensure_schema as ensure_agent_model_registry_schema
from agent_model_registry import list_agent_bindings as list_agent_model_bindings
from agent_model_registry import list_provider_configs as list_llm_provider_configs
from agent_model_registry import resolve_binding_for_task as resolve_llm_binding_for_task
from agent_model_registry import upsert_agent_binding as upsert_agent_model_binding
from agent_model_registry import upsert_provider_config as upsert_llm_provider_config
from agent_extension_registry import AGENT_IDS as extension_agent_ids
from agent_extension_registry import ensure_schema as ensure_agent_extension_registry_schema
from agent_extension_registry import extension_catalog as agent_extension_catalog
from agent_extension_registry import get_profile as get_agent_extension_profile
from agent_extension_registry import list_profiles as list_agent_extension_profiles
from agent_extension_registry import upsert_profile as upsert_agent_extension_profile
from multimodal_rag_adapter import raganything_status
from qdrant_config import rag_status
from user_auth import UserCreate
from user_auth import UserRead
from user_auth import UserUpdate
from user_auth import auth_backend
from user_auth import authenticate_identity_password
from user_auth import claims_from_user
from user_auth import ensure_bootstrap_admin
from user_auth import fastapi_users
from user_auth import get_user_from_access_token
from user_auth import init_auth_schema
from user_auth import issue_access_token_for_user
from billing import UsageReportRequest
from billing import apply_provider_webhook_event
from billing import create_checkout_order
from billing import enqueue_compensation_task
from billing import ensure_subscription
from billing import evaluate_guard
from billing import init_billing_schema
from billing import list_compensation_tasks
from billing import list_orders
from billing import list_webhook_events as billing_list_webhook_events
from billing import record_webhook_event
from billing import report_usage
from billing import resolve_compensation_task
from billing import run_reconciliation
from billing import update_order_after_webhook
from billing import usage_summary
from payment_gateway import payment_gateway
from regional_agent_system import get_regional_agent_manager
from seat_quota_tracker import SeatQuotaMutation
from seat_quota_tracker import SeatQuotaExceededError
from seat_quota_tracker import get_seat_quota_tracker
from seat_subscription_service import get_seat_billing_service
from channel_account_manager import channel_account_manager
from commander_router import get_strategy_intensity_manager
from commander_router import get_strategy_intensity_snapshot
from cron_scheduler import CronScheduler
from cron_scheduler import ScheduledTask
from cron_scheduler import SchedulerStore
from cron_scheduler import register_scheduler_routes
from autonomy_policy import get_autonomy_policy_manager
from heartbeat_engine import get_heartbeat_engine
from heartbeat_engine import get_active_checker
from alert_engine import AlertRule
from alert_engine import AlertSeverity
from alert_engine import NotificationChannel
from alert_engine import get_alert_engine
from feature_flags import Environment as FeatureFlagEnvironment
from feature_flags import FeatureFlag
from feature_flags import FeatureFlagContext
from feature_flags import FlagStrategy
from feature_flags import FlagVariant
from feature_flags import StrategyType
from feature_flags import get_feature_flag_client
from lobster_bootstrap import get_bootstrap_status_payload
from lobster_bootstrap import reset_bootstrap as reset_lobster_bootstrap
from lifecycle_manager import LobsterLifecycle
from lifecycle_manager import WorkflowLifecycle
from lifecycle_manager import get_lifecycle_manager
from lobster_registry_manager import get_lobster_summary
from lobsters.base_lobster import load_agents_rules
from lobsters.base_lobster import load_heartbeat
from lobsters.base_lobster import load_soul
from lobsters.base_lobster import load_working
from lobster_runner import LobsterRunSpec
from lobster_runner import LobsterRunner
from lobster_skill_registry import get_skill_registry
from skill_manifest_loader import load_prompt_assets_for_manifest
from skill_manifest_loader import load_skill_manifest
from skill_manifest_loader import update_skill_manifest
from skill_publish_policy import SkillPublishPolicy
from skill_scanner import scan_skill_content
from provider_registry import get_provider_registry
from provider_registry import provider_health_report
from provider_registry import start_llm_log_flusher
from provider_registry import stop_llm_log_flusher
from vllm_provider import get_hybrid_llm_router, vllm_roi_analysis
from media_cost_optimizer import get_media_cost_optimizer
from agent_commission_service import get_agent_commission_service, monthly_settlement_cron
from pagination import PaginatedResponse
from observability_api import make_observability_router
from api_lobster_realtime import router as realtime_router
from api_edge_telemetry import router as edge_telemetry_router
from official_workflow_templates import get_workflow_template_gallery
from module_registry import get_module_registry
from search_api import router as search_router
from tenant_audit_log import AuditEventType
from tenant_audit_log import AuditRetentionPolicy
from tenant_audit_log import get_audit_service
from tenant_context import TenantContext
from tenant_context import activate_tenant_context
from tenant_context import get_tenant_context
from tenant_context import reset_tenant_context
from tenant_context import resolve_optional_tenant_context
from dingtalk_channel import dingtalk_channel
from session_manager import get_session_manager
from usecase_registry import UsecaseRegistry
from usecase_registry import register_usecase_routes
from vector_snapshot_manager import VectorSnapshotManager
from vector_snapshot_manager import run_vector_backup_daily_loop
from workflow_engine import WorkflowEngine
from workflow_engine import list_workflows as list_workflow_definitions
from workflow_admin import load_workflow_document
from workflow_admin import update_workflow_document
from voice_orchestrator import get_voice_orchestrator
from voice_profile_registry import get_voice_profile_registry
from voice_consent_registry import get_voice_consent_registry
from workflow_idempotency import get_workflow_idempotency_store
from workflow_realtime import get_workflow_realtime_hub
from lead_conversion_fsm import get_lead_conversion_fsm
from lobster_cost_api import get_lobster_cost_analyzer
from tenant_concurrency import (
    QueueDepthExceededError,
    WorkflowRateLimitedError,
    get_tenant_concurrency_manager,
)
from workflow_webhook import get_workflow_webhook_store
from workflow_webhook import verify_webhook_auth
from clawteam_inbox import ensure_schema as ensure_clawteam_schema
from clawteam_inbox import claim_ready_tasks as clawteam_claim_ready_tasks
from clawteam_inbox import get_ready_tasks as clawteam_get_ready_tasks
from clawteam_inbox import heartbeat_worker as clawteam_heartbeat_worker
from clawteam_inbox import list_tasks as clawteam_list_tasks
from clawteam_inbox import list_workers as clawteam_list_workers
from clawteam_inbox import mark_many_completed as clawteam_mark_many_completed
from clawteam_inbox import mark_many_failed as clawteam_mark_many_failed
from clawteam_inbox import requeue_stale_running_tasks as clawteam_requeue_stale_running_tasks
from clawteam_inbox import summary as clawteam_summary
from clawwork_economy import credit_wallet
from clawwork_economy import daily_report as clawwork_daily_report
from clawwork_economy import ensure_schema as ensure_clawwork_schema
from clawwork_economy import status as clawwork_status
from feishu_channel import feishu_channel
from lossless_memory import append_event as append_lossless_event
from lossless_memory import ensure_schema as ensure_lossless_memory_schema
from lossless_memory import query_events as lossless_query_events
from lossless_memory import replay_trace as lossless_replay_trace
from lossless_memory import trace_snapshot as lossless_trace_snapshot
from memory_compressor import MemoryCompressor
from mcp_gateway import MCPServerConfig
from mcp_gateway import get_mcp_gateway
from memory_governor import ensure_schema as ensure_memory_governor_schema
from memory_governor import delete_kernel_rollout_template as memory_delete_kernel_rollout_template
from memory_governor import get_kernel_report as memory_get_kernel_report
from memory_governor import get_kernel_rollout_policy as memory_get_kernel_rollout_policy
from memory_governor import kernel_metrics_dashboard as memory_kernel_metrics_dashboard
from memory_governor import list_kernel_rollout_templates as memory_list_kernel_rollout_templates
from memory_governor import list_kernel_reports as memory_list_kernel_reports
from memory_governor import record_kernel_rollback as memory_record_kernel_rollback
from memory_governor import rename_kernel_rollout_template as memory_rename_kernel_rollout_template
from memory_governor import upsert_kernel_rollout_template as memory_upsert_kernel_rollout_template
from memory_governor import upsert_kernel_rollout_policy as memory_upsert_kernel_rollout_policy
from memory_governor import upsert_kernel_report as memory_upsert_kernel_report
from policy_bundle_manager import get_policy_bundle_manager
from policy_bandit import ensure_schema as ensure_policy_bandit_schema
from policy_bandit import snapshot as policy_bandit_snapshot
from policy_engine import GLOBAL_TENANT as POLICY_GLOBAL_TENANT
from policy_engine import get_policy_engine
from decision_logger import get_decision_logger
from comfyui_adapter import comfyui_status as integration_comfyui_status
from comfyui_adapter import query_prompt as integration_comfyui_query_prompt
from comfyui_capability_matrix import build_comfyui_generation_plan
from comfyui_capability_matrix import inspect_comfyui_capabilities
from media_post_pipeline import build_post_production_plan
from industry_workflows import detect_industry as detect_video_industry
from industry_workflows import list_workflow_templates as integration_list_workflow_templates
from industry_kb_pool import build_runtime_context as industry_kb_build_runtime_context
from industry_kb_pool import ensure_schema as ensure_industry_kb_schema
from industry_kb_pool import ingest_competitor_formulas as industry_kb_ingest_competitor_formulas
from industry_kb_pool import ingest_entries as industry_kb_ingest_entries
from industry_kb_pool import list_profiles as industry_kb_list_profiles
from industry_kb_pool import metrics_dashboard as industry_kb_metrics_dashboard
from industry_kb_pool import normalize_industry_tag as industry_kb_normalize_tag
from industry_kb_pool import profile_stats as industry_kb_profile_stats
from industry_kb_pool import record_run_metrics as industry_kb_record_run_metrics
from industry_kb_pool import trace_snapshot as industry_kb_trace_snapshot
from industry_kb_pool import upsert_profile as industry_kb_upsert_profile
from industry_starter_kit import ensure_schema as ensure_industry_starter_kit_schema
from industry_starter_kit import generate_starter_tasks as industry_generate_starter_tasks
from industry_starter_kit import list_starter_tasks as industry_list_starter_tasks
from industry_kb_bulk_seed import DEFAULT_BASE_PROFILE as industry_kb_default_base_profile
from industry_kb_bulk_seed import load_json_profile as industry_kb_load_json_profile
from industry_kb_bulk_seed import normalize_profile as industry_kb_normalize_profile
from industry_kb_bulk_seed import profile_to_entries as industry_kb_profile_to_entries
from industry_kb_bulk_seed import seed_all_subindustries as industry_kb_seed_all_subindustries
from industry_kb_profile_generator import generate_profile_with_retry as industry_kb_generate_profile_with_retry
from industry_taxonomy import bootstrap_profile_seeds as taxonomy_bootstrap_profile_seeds
from industry_taxonomy import coarse_to_subindustry_tag as taxonomy_coarse_to_subindustry_tag
from industry_taxonomy import list_industry_taxonomy as taxonomy_list_industry_taxonomy
from industry_taxonomy import profile_seed_from_tag as taxonomy_profile_seed_from_tag
from industry_taxonomy import resolve_subindustry_tag as taxonomy_resolve_subindustry_tag
from edge_rewards import claim_free_pack as edge_reward_claim_free_pack
from edge_rewards import consume_free_credits as edge_reward_consume_free_credits
from edge_rewards import ensure_schema as ensure_edge_rewards_schema
from edge_rewards import list_claims as edge_reward_list_claims
from edge_rewards import report_heartbeat as edge_reward_report_heartbeat
from edge_rewards import wallet_snapshot as edge_reward_wallet_snapshot
from edge_device_twin import EdgeActualState
from edge_device_twin import get_edge_twin_manager
from edge_outbox import EdgeOutbox
from edge_resource_governor import end_lease as edge_resource_end_lease
from edge_resource_governor import ensure_schema as ensure_edge_resource_governor_schema
from edge_resource_governor import get_consent as edge_resource_get_consent
from edge_resource_governor import list_leases as edge_resource_list_leases
from edge_resource_governor import revoke_consent as edge_resource_revoke_consent
from edge_resource_governor import start_lease as edge_resource_start_lease
from edge_resource_governor import summary as edge_resource_summary
from edge_resource_governor import upsert_consent as edge_resource_upsert_consent
from libtv_skill_adapter import libtv_status as integration_libtv_status
from libtv_skill_adapter import query_session as integration_libtv_query_session
from otp_relay import cancel_request as otp_cancel_request
from otp_relay import create_request as otp_create_request
from otp_relay import ensure_schema as ensure_otp_relay_schema
from otp_relay import get_request as otp_get_request
from otp_relay import list_requests as otp_list_requests
from otp_relay import mark_consumed as otp_mark_consumed
from otp_relay import submit_code as otp_submit_code
from workflow_template_registry import activate_template as registry_activate_template
from workflow_template_registry import import_template_from_github_raw as registry_import_template_from_github_raw
from workflow_template_registry import list_templates_by_industry as registry_list_templates_by_industry
from workflow_template_registry import list_templates as registry_list_templates
from workflow_template_registry import resolve_active_template as registry_resolve_active_template
from workflow_template_registry import recommended_github_sources as registry_recommended_github_sources
from workflow_template_catalog import recommend_official_templates as workflow_recommend_official_templates
from white_label_config import WhiteLabelConfig
from white_label_config import get_white_label_manager
from notification_center import notification_status as auth_notification_status
from notification_center import list_recent_notifications
from notification_center import send_test_notification
from research_radar_fetchers import fetch_github_hot
from research_radar_fetchers import fetch_github_latest
from research_radar_fetchers import fetch_huggingface_hot
from research_radar_fetchers import fetch_openalex_hot
from research_radar_fetchers import fetch_openalex_latest
from research_radar_fetchers import fetch_qbitai_latest
from research_radar_ranker import actionability_score as research_actionability_score
from research_radar_ranker import combined_score as research_combined_score
from research_radar_ranker import extract_tags as research_extract_tags
from research_radar_ranker import normalize_hot_score as research_normalize_hot_score
from research_radar_store import begin_fetch_run as research_begin_fetch_run
from research_radar_store import ensure_schema as ensure_research_radar_schema
from research_radar_store import finish_fetch_run as research_finish_fetch_run
from research_radar_store import list_signals as research_list_signals
from research_radar_store import list_source_health as research_list_source_health
from research_radar_store import record_source_health as research_record_source_health
from research_radar_store import run_health_summary as research_run_health_summary
from research_radar_store import upsert_signal as research_upsert_signal
from senate_kernel import build_memory_context as kernel_build_memory_context
from senate_kernel import classify_risk_taxonomy as kernel_classify_risk_taxonomy
from senate_kernel import compute_source_credibility as kernel_compute_source_credibility
from senate_kernel import constitutional_guardian as kernel_constitutional_guardian
from senate_kernel import estimate_strategy_confidence as kernel_estimate_strategy_confidence
from senate_kernel import persist_kernel_memory as kernel_persist_memory
from senate_kernel import verification_gate as kernel_verification_gate
from followup_subagent_store import ensure_schema as ensure_followup_subagent_schema
from followup_subagent_store import get_spawn_run as followup_get_spawn_run
from followup_subagent_store import list_recent_spawn_runs as followup_list_recent_spawn_runs
from agent_rag_pack_factory import catalog_overview as agent_rag_catalog_overview
from agent_rag_pack_factory import ensure_schema as ensure_agent_rag_pack_schema
from agent_rag_pack_factory import generate_pack_with_retry as agent_rag_generate_pack_with_retry
from agent_rag_pack_factory import list_targets as agent_rag_list_targets
from agent_rag_pack_factory import list_packs as agent_rag_list_packs
from agent_rag_pack_factory import list_profiles as agent_rag_list_profiles
from agent_rag_pack_factory import resolve_target as agent_rag_resolve_target
from agent_rag_pack_factory import summary_by_agent as agent_rag_summary_by_agent
from agent_rag_pack_factory import _fallback_pack as agent_rag_fallback_pack
from agent_rag_pack_factory import upsert_pack as agent_rag_upsert_pack

try:
    from prometheus_fastapi_instrumentator import Instrumentator
except Exception:  # noqa: BLE001
    Instrumentator = None  # type: ignore[assignment]

load_dotenv()

ALGORITHM = "HS256"
security = HTTPBearer(auto_error=False)
DEFAULT_INDUSTRY_KB_PROMPT_PATH = str(
    (Path(__file__).resolve().parent / "prompts" / "industry_kb_consumer_prompt.txt")
)


class LoginRequest(BaseModel):
    username: str
    password: str
    otp_code: str | None = None


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class MfaCodeRequest(BaseModel):
    otp_code: str = Field(..., min_length=6, max_length=12)


class UserClaims(BaseModel):
    sub: str
    tenant_id: str
    roles: list[str] = Field(default_factory=list)
    exp: int = 0


class ScimPrincipal(BaseModel):
    tenant_id: str
    actor_id: str
    auth_mode: str = "scim_token"


class FederationProviderUpsertRequest(BaseModel):
    provider_id: str | None = Field(default=None, max_length=64)
    name: str = Field(..., min_length=1, max_length=128)
    tenant_id: str | None = Field(default=None, max_length=128)
    issuer: str | None = Field(default=None, max_length=500)
    audience: str | None = Field(default=None, max_length=500)
    client_id: str | None = Field(default=None, max_length=500)
    client_secret: str | None = Field(default=None, max_length=5000)
    discovery_url: str | None = Field(default=None, max_length=1000)
    authorization_endpoint: str | None = Field(default=None, max_length=1000)
    token_endpoint: str | None = Field(default=None, max_length=1000)
    jwks_uri: str | None = Field(default=None, max_length=1000)
    jwks_json: dict[str, Any] | list[Any] | str | None = None
    public_key_pem: str | dict[str, Any] | list[Any] | None = None
    algorithms: list[str] = Field(default_factory=lambda: ["RS256"])
    scopes: list[str] = Field(default_factory=lambda: ["openid", "profile", "email"])
    use_pkce: bool = True
    username_claim: str = Field(default="preferred_username", max_length=128)
    email_claim: str = Field(default="email", max_length=128)
    roles_claim: str = Field(default="roles", max_length=128)
    subject_claim: str = Field(default="sub", max_length=128)
    default_roles: list[str] = Field(default_factory=lambda: ["member"])
    allowed_domains: list[str] = Field(default_factory=list)
    discovery_domains: list[str] = Field(default_factory=list)
    sync_roles: bool = True
    auto_create_user: bool = True
    enabled: bool = True


class FederatedExchangeRequest(BaseModel):
    provider_id: str = Field(..., min_length=1, max_length=64)
    token: str = Field(..., min_length=20, max_length=50000)


class FederatedCallbackQuery(BaseModel):
    code: str = Field(..., min_length=1, max_length=5000)
    state: str = Field(..., min_length=8, max_length=500)


class SsoDiscoveryResponse(BaseModel):
    ok: bool = True
    matched: bool = False
    provider_id: str | None = None
    provider_name: str | None = None
    authorize_url: str | None = None
    reason: str | None = None


class StrategyIntensityMutationRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    lobster_id: str | None = Field(default=None, min_length=1, max_length=64)
    reason: str | None = Field(default=None, max_length=500)


class AutonomyPolicyUpdateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    default_level: int | None = Field(default=None, ge=0, le=3)
    per_lobster_overrides: dict[str, int] = Field(default_factory=dict)
    reason: str | None = Field(default=None, max_length=500)


class PolicyRuleRequest(BaseModel):
    rule_id: str | None = Field(default=None, max_length=128)
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    policy_path: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=2000)
    conditions: list[dict[str, Any]] = Field(default_factory=list)
    condition_logic: str = Field(default="AND", pattern="^(AND|OR)$")
    effect: str = Field(..., pattern="^(allow|deny|dispatch)$")
    target: str | None = Field(default=None, max_length=128)
    priority: int = Field(default=100, ge=0, le=100000)
    enabled: bool = True
    tags: list[str] = Field(default_factory=list)


class PolicyEvaluateRequest(BaseModel):
    policy_path: str = Field(..., min_length=1, max_length=128)
    input_data: dict[str, Any] = Field(default_factory=dict, alias="input")
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    lobster_id: str | None = Field(default=None, min_length=1, max_length=128)
    task_id: str | None = Field(default=None, min_length=1, max_length=128)
    default_decision: str = Field(default="deny", min_length=1, max_length=128)
    trace: bool = False

    model_config = {"populate_by_name": True}


class PolicyBundlePublishRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    version: str | None = Field(default=None, min_length=1, max_length=128)
    notes: str | None = Field(default=None, max_length=1000)
    policy_paths: list[str] = Field(default_factory=list)
    force: bool = False


class WorkflowRunRequest(BaseModel):
    workflow_id: str = Field(..., min_length=1, max_length=128)
    task: str = Field(..., min_length=1, max_length=4000)
    industry: str | None = Field(default=None, min_length=1, max_length=120)
    industry_tag: str | None = Field(default=None, min_length=1, max_length=120)
    context: dict[str, Any] = Field(default_factory=dict)
    industry_workflow_context: dict[str, Any] = Field(default_factory=dict)
    notify_url: str | None = Field(default=None, max_length=500)
    idempotency_key: str | None = Field(default=None, max_length=200)


class MCPServerRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=200)
    transport: str = Field(..., pattern="^(stdio|sse|edge)$")
    command: str | None = Field(default=None, max_length=1000)
    url: str | None = Field(default=None, max_length=1000)
    env: dict[str, str] = Field(default_factory=dict)
    enabled: bool = True
    allowed_lobsters: list[str] = Field(default_factory=list)
    edge_node_id: str | None = Field(default=None, max_length=128)


class MCPServerUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    transport: str | None = Field(default=None, pattern="^(stdio|sse|edge)$")
    command: str | None = Field(default=None, max_length=1000)
    url: str | None = Field(default=None, max_length=1000)
    env: dict[str, str] | None = None
    enabled: bool | None = None
    allowed_lobsters: list[str] | None = None
    edge_node_id: str | None = Field(default=None, max_length=128)


class MCPCallRequest(BaseModel):
    server_id: str = Field(..., min_length=1, max_length=128)
    tool_name: str = Field(..., min_length=1, max_length=200)
    args: dict[str, Any] = Field(default_factory=dict)
    lobster_id: str = Field(default="manual_test", min_length=1, max_length=128)
    session_id: str | None = Field(default=None, max_length=128)


class ToolListingRequest(BaseModel):
    tool_id: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=1000)
    category: str = Field(..., min_length=1, max_length=64)
    icon: str = Field(default="", max_length=200)
    mcp_endpoint: str = Field(..., min_length=1, max_length=500)
    version: str = Field(default="1.0.0", max_length=64)
    author: str = Field(default="system", max_length=128)
    is_builtin: bool = False
    is_active: bool = True
    monthly_cost_usd: float = Field(default=0.0, ge=0.0)
    tags: list[str] = Field(default_factory=list)


class ToolSubscriptionRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    tool_id: str = Field(..., min_length=1, max_length=128)


class McpToolPolicyLimitRequest(BaseModel):
    max_calls_per_minute: int = Field(default=60, ge=1, le=10000)
    max_calls_per_session: int = Field(default=200, ge=1, le=100000)
    max_cost_per_call: float = Field(default=0.10, ge=0.0, le=10000.0)


class McpToolPolicyUpdateRequest(BaseModel):
    allowed_tools: list[str] = Field(default_factory=list)
    denied_tools: list[str] = Field(default_factory=list)
    limits: dict[str, McpToolPolicyLimitRequest] = Field(default_factory=dict)
    allow_unknown_tools: bool = False


class EdgeNodeGroupCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    parent_group_id: str | None = Field(default=None, max_length=64)
    description: str = Field(default="", max_length=500)
    tags: list[str] = Field(default_factory=list)


class EdgeGroupBatchDispatchRequest(BaseModel):
    action_type: str = Field(default="START_CAMPAIGN", min_length=1, max_length=64)
    payload: dict[str, Any] = Field(default_factory=dict)


class LobsterTriggerRuleUpsertRequest(BaseModel):
    rule_id: str | None = Field(default=None, max_length=64)
    tenant_id: str | None = Field(default=None, max_length=128)
    name: str = Field(..., min_length=1, max_length=120)
    conditions: list[dict[str, Any]] = Field(default_factory=list)
    action: dict[str, Any] = Field(default_factory=dict)
    condition_logic: str = Field(default="AND", pattern="^(AND|OR)$")
    is_active: bool = True
    cooldown_seconds: int = Field(default=300, ge=0, le=86400)


class LobsterDocUpdateRequest(BaseModel):
    content: str = Field(..., min_length=1)


class QueryExpandRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4000)
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    active_lobsters: list[str] = Field(default_factory=list)


class LobsterConfigUpdateRequest(BaseModel):
    strategy_level: int | None = Field(default=None, ge=1, le=4)
    autonomy_level: int | None = Field(default=None, ge=0, le=3)
    active_skills: list[str] | None = None
    active_tools: list[str] | None = None
    custom_prompt: str | None = Field(default=None, max_length=4000)


class ConnectorCredentialUpsertRequest(BaseModel):
    credential: dict[str, Any] = Field(default_factory=dict)


class WidgetConfigUpdateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    widget_id: str | None = Field(default=None, max_length=64)
    enabled: bool | None = None
    allowed_origins: list[str] | None = None
    allowed_domains: list[str] | None = None
    welcome_message: str | None = Field(default=None, max_length=400)
    theme_primary: str | None = Field(default=None, max_length=20)
    theme_color: str | None = Field(default=None, max_length=20)
    accent_color: str | None = Field(default=None, max_length=20)
    custom_css: str | None = Field(default=None, max_length=4000)
    call_to_action: str | None = Field(default=None, max_length=120)
    launcher_label: str | None = Field(default=None, max_length=40)
    auto_open: bool | None = None
    capture_mode: str | None = Field(default=None, max_length=40)


class WidgetMessageRequest(BaseModel):
    widget_id: str = Field(..., min_length=1, max_length=64)
    session_id: str | None = Field(default=None, max_length=64)
    message: str = Field(..., min_length=1, max_length=4000)
    visitor_meta: dict[str, Any] = Field(default_factory=dict)


class WidgetCloseRequest(BaseModel):
    widget_id: str | None = Field(default=None, max_length=64)


class FeedbackSubmitRequest(BaseModel):
    task_id: str = Field(..., min_length=1, max_length=128)
    lobster_id: str = Field(..., min_length=1, max_length=64)
    rating: str = Field(..., min_length=1, max_length=32)
    tags: list[str] = Field(default_factory=list)
    comment: str | None = Field(default=None, max_length=1000)
    revised_output: str | None = Field(default=None, max_length=20000)
    input_prompt: str | None = Field(default=None, max_length=20000)
    original_output: str | None = Field(default=None, max_length=20000)


class KnowledgeBaseCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)


class KnowledgeBaseDocumentRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_base64: str | None = Field(default=None, max_length=5_000_000)
    text: str | None = Field(default=None, max_length=200_000)


class FileLoaderTextRequest(BaseModel):
    filename: str = Field(..., min_length=1, max_length=255)
    content_base64: str | None = Field(default=None, max_length=8_000_000)
    text: str | None = Field(default=None, max_length=500_000)


class MindMapNodeUpdateRequest(BaseModel):
    new_facts: list[str] = Field(default_factory=list)
    answered_questions: list[str] = Field(default_factory=list)
    source: str = Field(..., min_length=1, max_length=128)
    confidence: float = Field(default=0.8, ge=0.0, le=1.0)


class SurveyCreateRequest(BaseModel):
    survey_id: str | None = Field(default=None, max_length=128)
    title: str = Field(..., min_length=1, max_length=200)
    survey_type: str = Field(..., pattern="^(nps|csat|open)$")
    trigger_event: str = Field(..., min_length=1, max_length=64)
    trigger_conditions: dict[str, Any] = Field(default_factory=dict)
    questions: list[dict[str, Any]] = Field(default_factory=list)
    enabled: bool = True


class SurveyRespondRequest(BaseModel):
    survey_id: str = Field(..., min_length=1, max_length=128)
    respondent_id: str | None = Field(default=None, max_length=128)
    answers: dict[str, Any] = Field(default_factory=dict)
    lobster_task_id: str | None = Field(default=None, max_length=128)


class NLQueryRequest(BaseModel):
    question: str | None = Field(default=None, min_length=1, max_length=2000)
    query: str | None = Field(default=None, min_length=1, max_length=2000)
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)


class RuleConditionRequest(BaseModel):
    field: str = Field(..., min_length=1, max_length=200)
    op: str = Field(..., min_length=1, max_length=32)
    value: Any


class RuleActionRequest(BaseModel):
    action_type: str = Field(..., min_length=1, max_length=64)
    params: dict[str, Any] = Field(default_factory=dict)


class LobsterRuleUpsertRequest(BaseModel):
    rule_id: str = Field(..., min_length=1, max_length=128)
    name: str = Field(..., min_length=1, max_length=200)
    description: str = Field(default="", max_length=500)
    tenant_id: str = Field(default="*", min_length=1, max_length=128)
    conditions: list[RuleConditionRequest] = Field(default_factory=list)
    condition_logic: str = Field(default="AND", pattern="^(AND|OR)$")
    actions: list[RuleActionRequest] = Field(default_factory=list)
    priority: int = Field(default=100, ge=1, le=10000)
    enabled: bool = True
    tags: list[str] = Field(default_factory=list)


class RuleEngineEventRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    event: dict[str, Any] = Field(default_factory=dict)


class EdgeTargetModel(BaseModel):
    edge_id: str = Field(..., min_length=1, max_length=128)
    account_id: str | None = Field(default=None, max_length=128)
    webhook_url: str | None = Field(default=None, max_length=500)
    instruction_hint: str | None = Field(default=None, max_length=500)
    skills: list[str] = Field(default_factory=list)
    skill_manifest_path: str | None = Field(default=None, max_length=500)
    skill_commands: list[str] = Field(default_factory=list)
    skill_manifest_meta: dict[str, Any] = Field(default_factory=dict)


class TaskRequest(BaseModel):
    task_description: str = Field(..., min_length=1, max_length=4000)
    user_id: str = Field(..., min_length=1, max_length=128)
    competitor_handles: list[str] = Field(default_factory=list)
    industry: str | None = Field(default=None, min_length=1, max_length=120)
    industry_tag: str | None = Field(default=None, min_length=1, max_length=64)
    industry_kb_limit: int = Field(default=6, ge=1, le=20)
    edge_targets: list[EdgeTargetModel] = Field(default_factory=list)
    client_preview: dict[str, Any] = Field(default_factory=dict)
    industry_workflow_context: dict[str, Any] = Field(default_factory=dict)


class TaskResponse(BaseModel):
    status: str
    request_id: str
    thread_id: str
    industry_tag: str | None = None
    query_expansion: dict[str, Any] = Field(default_factory=dict)
    survey_suggestions: list[dict[str, Any]] = Field(default_factory=list)
    industry_kb_context: list[dict[str, Any]] = Field(default_factory=list)
    industry_kb_metrics: dict[str, Any] = Field(default_factory=dict)
    score: float | None = None
    hot_topics: list[str] = Field(default_factory=list)
    competitor_analysis: dict[str, Any] = Field(default_factory=dict)
    content_package: dict[str, Any] = Field(default_factory=dict)
    delivery_results: list[dict[str, Any]] = Field(default_factory=list)
    leads: list[dict[str, Any]] = Field(default_factory=list)
    lead_conversion: dict[str, Any] = Field(default_factory=dict)
    competitor_formulas: list[dict[str, Any]] = Field(default_factory=list)
    competitor_multimodal_assets: list[dict[str, Any]] = Field(default_factory=list)
    rag_mode: str | None = None
    rag_ingested_count: int = 0
    dispatch_plan: dict[str, Any] = Field(default_factory=dict)
    edge_skill_plan: dict[str, Any] = Field(default_factory=dict)
    clawteam_queue: dict[str, Any] = Field(default_factory=dict)
    followup_spawn: dict[str, Any] = Field(default_factory=dict)
    policy_bandit: dict[str, Any] = Field(default_factory=dict)
    constitutional_guardian: dict[str, Any] = Field(default_factory=dict)
    verification_gate: dict[str, Any] = Field(default_factory=dict)
    memory_governor: dict[str, Any] = Field(default_factory=dict)
    agent_extensions: list[dict[str, Any]] = Field(default_factory=list)
    skills_pool_summary: dict[str, Any] = Field(default_factory=dict)
    publish_allowed: bool = False
    reason_codes: list[str] = Field(default_factory=list)
    confidence_band: str | None = None
    hitl_required: bool = False
    hitl_decision: str | None = None
    hitl_approval_id: str | None = None
    hitl_reason: str | None = None
    kernel_report: dict[str, Any] = Field(default_factory=dict)
    call_log: list[Any] = Field(default_factory=list)
    evolution: list[Any] = Field(default_factory=list)


class TaskAsyncAcceptedResponse(BaseModel):
    ok: bool = True
    job_id: str
    status: str
    status_url: str
    request_id: str


class TaskAsyncStatusResponse(BaseModel):
    ok: bool = True
    job_id: str
    status: str
    request_id: str
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None
    user_id: str
    tenant_id: str
    thread_id: str | None = None
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class AnalyzeCompetitorFormulaRequest(BaseModel):
    target_account_url: str = Field(..., min_length=1, max_length=1000)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    competitor_handles: list[str] = Field(default_factory=list)


class AnalyzeCompetitorFormulaResponse(BaseModel):
    status: str
    request_id: str
    thread_id: str
    target_account_url: str
    competitor_formulas: list[dict[str, Any]] = Field(default_factory=list)
    competitor_multimodal_assets: list[dict[str, Any]] = Field(default_factory=list)
    rag_mode: str | None = None
    rag_ingested_count: int = 0
    call_log: list[Any] = Field(default_factory=list)
    evolution: list[Any] = Field(default_factory=list)


class KernelRolloutPolicyUpdateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool = True
    rollout_ratio: float = Field(default=100.0, ge=0.0, le=100.0)
    block_mode: str = Field(default="hitl", pattern="^(hitl|deny)$")
    risk_rollout: dict[str, Any] = Field(default_factory=dict)
    window_start_utc: str | None = None
    window_end_utc: str | None = None
    note: str | None = Field(default=None, max_length=300)


class KernelRolloutTemplateSaveRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    template_key: str | None = Field(default=None, min_length=1, max_length=64)
    template_name: str = Field(..., min_length=1, max_length=80)
    risk_rollout: dict[str, Any] = Field(default_factory=dict)
    note: str | None = Field(default=None, max_length=300)


class KernelRolloutTemplateRenameRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    new_template_key: str | None = Field(default=None, min_length=1, max_length=64)
    template_name: str | None = Field(default=None, min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=300)


class KernelRolloutTemplateImportItem(BaseModel):
    template_key: str | None = Field(default=None, min_length=1, max_length=64)
    template_name: str = Field(..., min_length=1, max_length=80)
    risk_rollout: dict[str, Any] = Field(default_factory=dict)
    note: str | None = Field(default=None, max_length=300)


class KernelRolloutTemplateImportRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    source_tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    mode: str = Field(default="upsert", pattern="^(upsert|skip_existing|replace_all)$")
    templates: list[KernelRolloutTemplateImportItem] = Field(default_factory=list)


class KernelRollbackRequest(BaseModel):
    stage: str = Field(default="preflight", pattern="^(preflight|postgraph)$")
    dry_run: bool = True
    approval_id: str | None = Field(default=None, min_length=1, max_length=128)


class EdgeRegisterRequest(BaseModel):
    edge_id: str = Field(..., min_length=1, max_length=128)
    user_id: str = Field(..., min_length=1, max_length=128)
    account_id: str = Field(..., min_length=1, max_length=128)
    webhook_url: str | None = Field(default=None, max_length=500)
    skills: list[str] = Field(default_factory=list)
    skill_manifest_path: str | None = Field(default=None, max_length=500)
    skill_commands: list[str] = Field(default_factory=list)
    skill_manifest_meta: dict[str, Any] = Field(default_factory=dict)
    consent_version: str = Field(default="v1", min_length=1, max_length=32)
    consent_accepted: bool = Field(default=False)
    ip_share_enabled: bool = Field(default=False)
    compute_share_enabled: bool = Field(default=False)
    otp_relay_enabled: bool = Field(default=True)


class MobilePairCodeCreateRequest(BaseModel):
    ttl_sec: int = Field(default=300, ge=60, le=300)
    device_hint: str | None = Field(default=None, max_length=200)


class MobilePairRequest(BaseModel):
    access_code: str = Field(..., min_length=4, max_length=32)
    device_info: dict[str, Any] = Field(default_factory=dict)
    push_token: str | None = Field(default=None, max_length=1000)


class MobilePushRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    user_id: str | None = Field(default=None, max_length=128)
    edge_id: str | None = Field(default=None, max_length=128)
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1, max_length=2000)
    data: dict[str, Any] = Field(default_factory=dict)
    push_token: str | None = Field(default=None, max_length=1000)


class EdgeConsentUpdateRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    consent_version: str = Field(default="v1", min_length=1, max_length=32)
    consent_accepted: bool = Field(default=False)
    ip_share_enabled: bool = Field(default=False)
    compute_share_enabled: bool = Field(default=False)
    otp_relay_enabled: bool = Field(default=True)
    notes: str | None = Field(default=None, max_length=500)


class EdgeConsentRevokeRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class EdgeLeaseStartRequest(BaseModel):
    edge_id: str = Field(..., min_length=1, max_length=128)
    resource_type: str = Field(..., pattern="^(ip_proxy|compute)$")
    purpose_code: str = Field(..., min_length=1, max_length=64)
    requester: str | None = Field(default=None, max_length=128)
    approved_by: str | None = Field(default=None, max_length=128)
    trace_id: str | None = Field(default=None, max_length=128)
    task_id: str | None = Field(default=None, max_length=128)
    metadata: dict[str, Any] = Field(default_factory=dict)


class EdgeLeaseEndRequest(BaseModel):
    lease_id: str = Field(..., min_length=1, max_length=64)
    status: str = Field(default="ended", min_length=1, max_length=32)
    reason: str | None = Field(default=None, max_length=300)
    operator: str | None = Field(default=None, max_length=128)


class EdgeDmRequest(BaseModel):
    edge_id: str = Field(..., min_length=1, max_length=128)
    dm_text: str = Field(..., min_length=1, max_length=4000)
    account_id: str = Field(..., min_length=1, max_length=128)


class EdgePullResponse(BaseModel):
    edge_id: str
    count: int
    packages: list[dict[str, Any]]


class EdgeAckRequest(BaseModel):
    edge_id: str | None = Field(default=None, max_length=128)


class EdgeHeartbeatRequest(BaseModel):
    edge_id: str = Field(..., min_length=1, max_length=128)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    account_id: str | None = Field(default=None, min_length=1, max_length=128)
    status: str = Field(default="online", min_length=1, max_length=32)
    cpu_percent: float = Field(default=0.0, ge=0.0, le=100.0)
    memory_percent: float = Field(default=0.0, ge=0.0, le=100.0)
    memory_usage_mb: int = Field(default=0, ge=0)
    ip_hash: str | None = Field(default=None, max_length=256)
    lobster_configs: dict[str, str] = Field(default_factory=dict)
    skill_versions: dict[str, str] = Field(default_factory=dict)
    pending_task_count: int = Field(default=0, ge=0)
    running_task_count: int = Field(default=0, ge=0)
    max_concurrent_tasks: int = Field(default=0, ge=0)
    log_level: str = Field(default="INFO", max_length=32)
    meta_cache_status: str = Field(default="cold", max_length=32)
    edge_version: str = Field(default="", max_length=64)
    reported_resource_version: int = Field(default=0, ge=0)


class EdgeTwinDesiredUpdateRequest(BaseModel):
    updates: dict[str, Any] = Field(default_factory=dict)


class EdgeRewardClaimRequest(BaseModel):
    claim_type: str = Field(default="free_pack", min_length=1, max_length=64)
    note: str | None = Field(default=None, max_length=200)


class OtpRequestCreateRequest(BaseModel):
    edge_id: str = Field(..., min_length=1, max_length=128)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    account_id: str | None = Field(default=None, max_length=128)
    platform: str = Field(default="douyin", min_length=1, max_length=64)
    purpose: str = Field(default="login", min_length=1, max_length=64)
    masked_target: str | None = Field(default=None, max_length=128)
    message: str | None = Field(default=None, max_length=500)
    feishu_chat_id: str | None = Field(default=None, max_length=128)
    ttl_sec: int | None = Field(default=None, ge=60, le=1800)
    max_attempts: int | None = Field(default=None, ge=1, le=10)
    trace_id: str | None = Field(default=None, max_length=128)


class OtpSubmitRequest(BaseModel):
    request_id: str = Field(..., min_length=1, max_length=64)
    code: str = Field(..., min_length=4, max_length=12)
    operator: str | None = Field(default=None, max_length=128)


class OtpCancelRequest(BaseModel):
    request_id: str = Field(..., min_length=1, max_length=64)
    reason: str | None = Field(default=None, max_length=200)


class OtpConsumeRequest(BaseModel):
    request_id: str = Field(..., min_length=1, max_length=64)
    edge_id: str = Field(..., min_length=1, max_length=128)
    status: str = Field(default="consumed", min_length=1, max_length=32)
    reason: str | None = Field(default=None, max_length=200)


class CampaignSimulationRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    task_description: str = Field(..., min_length=1, max_length=4000)
    competitor_handles: list[str] = Field(default_factory=list)
    edge_targets: list[EdgeTargetModel] = Field(default_factory=list)


class CampaignSimulationApproveRequest(BaseModel):
    simulation_id: str = Field(..., min_length=1, max_length=64)
    decision: str = Field(default="approve", min_length=1, max_length=16)
    reason: str | None = Field(default=None, max_length=500)


class HitlDecisionRequest(BaseModel):
    approval_id: str = Field(..., min_length=1, max_length=128)
    decision: str = Field(..., min_length=1, max_length=16)
    operator: str | None = Field(default=None, max_length=128)
    reason: str | None = Field(default=None, max_length=500)


class AnythingLLMWorkspaceEnsureRequest(BaseModel):
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    workspace_name: str | None = Field(default=None, min_length=1, max_length=120)


class ComfyTemplateImportRequest(BaseModel):
    industry: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)
    raw_url: str = Field(..., min_length=8, max_length=1000)
    source_repo: str | None = Field(default=None, max_length=256)
    ref: str | None = Field(default="main", max_length=64)
    activate: bool = Field(default=True)


class ComfyTemplateActivateRequest(BaseModel):
    industry: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=120)


class ComfyPipelinePlanRequest(BaseModel):
    task_description: str = Field(..., min_length=1, max_length=4000)
    industry: str = Field(default="general", min_length=1, max_length=64)
    media_urls: list[str] = Field(default_factory=list)
    force_human_approval: bool = Field(default=True)


class EconomyCreditRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=128)
    amount_cny: float = Field(..., gt=0, le=100000)
    note: str | None = Field(default=None, max_length=200)


class LlmSmokeRequest(BaseModel):
    prompt: str = Field(default="请回复 ok", min_length=1, max_length=2000)
    force_cloud: bool = Field(default=True)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    tenant_tier: str = Field(default="pro", min_length=1, max_length=32)
    task_type: str = Field(default="llm_smoke", min_length=1, max_length=64)
    force_tier: str | None = Field(default=None, pattern="^(flash|standard|pro|frontier)$")


class LlmProviderConfigUpdateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool = True
    route: str = Field(default="cloud", pattern="^(local|cloud)$")
    base_url: str = Field(default="", max_length=500)
    default_model: str = Field(default="", max_length=120)
    api_key: str | None = Field(default=None, max_length=300)
    note: str | None = Field(default=None, max_length=300)


class ProviderCreateRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    type: str = Field(default="openai_compatible", pattern="^(local|openai_compatible|anthropic|gemini)$")
    route: str = Field(default="cloud", pattern="^(local|cloud)$")
    base_url: str = Field(default="", max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    models: list[str] = Field(default_factory=list)
    default_model: str = Field(default="", max_length=120)
    priority: int = Field(default=100, ge=0, le=10000)
    weight: float = Field(default=1.0, ge=0.0, le=100.0)
    enabled: bool = True
    note: str | None = Field(default=None, max_length=300)


class ProviderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    type: str | None = Field(default=None, pattern="^(local|openai_compatible|anthropic|gemini)$")
    route: str | None = Field(default=None, pattern="^(local|cloud)$")
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    models: list[str] | None = None
    default_model: str | None = Field(default=None, max_length=120)
    priority: int | None = Field(default=None, ge=0, le=10000)
    weight: float | None = Field(default=None, ge=0.0, le=100.0)
    enabled: bool | None = None
    note: str | None = Field(default=None, max_length=300)


class ProviderSmokeRequest(BaseModel):
    prompt: str = Field(default="请回复 ok", min_length=1, max_length=2000)


class FeatureFlagStrategyRequest(BaseModel):
    type: str = Field(..., min_length=1, max_length=64)
    parameters: dict[str, Any] = Field(default_factory=dict)


class FeatureFlagVariantRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    weight: int = Field(default=0, ge=0, le=1000)
    payload: Any = None
    enabled: bool = True


class FeatureFlagCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    enabled: bool = True
    environment: str = Field(default="prod", pattern="^(dev|staging|prod)$")
    strategies: list[FeatureFlagStrategyRequest] = Field(default_factory=list)
    variants: list[FeatureFlagVariantRequest] = Field(default_factory=list)
    description: str = Field(default="", max_length=500)
    tags: list[str] = Field(default_factory=list)
    tenant_id: str | None = Field(default=None, max_length=128)


class FeatureFlagUpdateRequest(BaseModel):
    enabled: bool | None = None
    environment: str | None = Field(default=None, pattern="^(dev|staging|prod)$")
    strategies: list[FeatureFlagStrategyRequest] | None = None
    variants: list[FeatureFlagVariantRequest] | None = None
    description: str | None = Field(default=None, max_length=500)
    tags: list[str] | None = None
    tenant_id: str | None = Field(default=None, max_length=128)


class FeatureFlagCheckRequest(BaseModel):
    flag_name: str = Field(..., min_length=1, max_length=200)
    tenant_id: str = Field(default="tenant_main", min_length=1, max_length=128)
    user_id: str = Field(default="", max_length=128)
    lobster_id: str = Field(default="", max_length=64)
    edge_node_id: str = Field(default="", max_length=128)
    edge_node_tags: list[str] = Field(default_factory=list)
    environment: str = Field(default="prod", pattern="^(dev|staging|prod)$")


class FeatureFlagImportRequest(BaseModel):
    flags: list[dict[str, Any]] = Field(default_factory=list)


class PromptExperimentCreateRequest(BaseModel):
    lobster_name: str = Field(..., min_length=1, max_length=64)
    skill_name: str = Field(..., min_length=1, max_length=128)
    rollout_percent: int = Field(default=10, ge=1, le=100)
    control_variant: str = Field(default="control", min_length=1, max_length=64)
    experiment_variant: str = Field(default="v2", min_length=1, max_length=64)
    prompt_text: str = Field(..., min_length=1)
    environment: str = Field(default="prod", pattern="^(dev|staging|prod)$")


class PromptExperimentPromoteRequest(BaseModel):
    winner_variant: str = Field(..., min_length=1, max_length=64)


class ExperimentCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    lobster_name: str = Field(..., min_length=1, max_length=64)
    prompt_name: str = Field(default="", max_length=200)
    prompt_version: str = Field(default="", max_length=64)
    model: str = Field(default="", max_length=128)
    dataset_id: str = Field(default="", max_length=128)
    source: str = Field(default="manual", max_length=64)
    metrics: list[str] = Field(default_factory=list)
    config: dict[str, Any] = Field(default_factory=dict)
    notes: str = Field(default="", max_length=1000)
    status: str = Field(default="running", pattern="^(running|completed|failed)$")


class ExperimentRunRequest(BaseModel):
    concurrency: int | None = Field(default=None, ge=1, le=32)


class RagTestsetGenerateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    test_size: int = Field(default=50, ge=1, le=500)
    dataset_name: str | None = Field(default=None, min_length=1, max_length=200)
    save_to_dataset_store: bool = True
    distributions: dict[str, float] = Field(default_factory=dict)


class LogQueryRequest(BaseModel):
    sql: str = Field(..., min_length=1, max_length=5000)
    time_range_hours: int = Field(default=1, ge=1, le=24 * 30)


class LifecycleChangeRequest(BaseModel):
    new_lifecycle: str = Field(..., pattern="^(experimental|production|deprecated)$")
    reason: str | None = Field(default=None, max_length=500)


class WorkflowLifecycleChangeRequest(BaseModel):
    new_lifecycle: str = Field(..., pattern="^(draft|active|paused|archived)$")
    reason: str | None = Field(default=None, max_length=500)


class AlertRuleRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    metric: str = Field(..., min_length=1, max_length=64)
    aggregation: str = Field(default="avg", max_length=32)
    condition: str = Field(default=">", pattern="^(<|>|<=|>=|==)$")
    threshold: float
    window_seconds: int = Field(default=300, ge=60, le=86400)
    pending_seconds: int = Field(default=0, ge=0, le=86400)
    silence_seconds: int = Field(default=600, ge=0, le=86400)
    severity: str = Field(default="warning", pattern="^(critical|warning|info)$")
    lobster_filter: str | None = Field(default=None, max_length=64)
    tenant_filter: str | None = Field(default=None, max_length=128)
    edge_node_filter: str | None = Field(default=None, max_length=128)
    notification_channel_ids: list[str] = Field(default_factory=list)
    enabled: bool = True


class NotificationChannelRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    channel_type: str = Field(..., min_length=1, max_length=64)
    config: dict[str, Any] = Field(default_factory=dict)
    severity_filter: str = Field(default="all", pattern="^(critical|warning|info|all)$")
    enabled: bool = True


class WorkflowReplayRequest(BaseModel):
    from_step_id: str | None = Field(default=None, max_length=120)


class WorkflowWebhookCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    http_method: str = Field(default="POST", pattern="^(POST|GET|ANY)$")
    auth_type: str = Field(default="none", pattern="^(none|header_token|basic_auth)$")
    auth_config: dict[str, Any] = Field(default_factory=dict)
    response_mode: str = Field(default="immediate", pattern="^(immediate|wait_for_completion)$")


class WorkflowDefinitionUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    error_workflow_id: str | None = Field(default=None, max_length=120)
    error_notify_channels: list[str] | None = Field(default=None)


class HybridMemorySearchRequest(BaseModel):
    tenant_id: str = Field(default="tenant_main", min_length=1, max_length=128)
    node_id: str = Field(default="", max_length=128)
    lobster_name: str = Field(default="", max_length=64)
    query: str = Field(..., min_length=1, max_length=1000)
    memory_type: str | None = Field(default=None, max_length=64)
    days: int | None = Field(default=None, ge=1, le=365)
    top_k: int = Field(default=10, ge=1, le=50)


class VectorBackupTriggerRequest(BaseModel):
    collections: list[str] | None = Field(default=None)


class ResourcePermissionRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    resource_type: str = Field(..., min_length=1, max_length=64)
    resource_id: str = Field(..., min_length=1, max_length=200)
    scope: str = Field(..., min_length=1, max_length=32)
    subject_type: str = Field(..., pattern="^(role|user)$")
    subject_id: str = Field(..., min_length=1, max_length=128)
    granted: bool = True
    note: str | None = Field(default=None, max_length=300)


class ResourcePermissionCheckRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    user_id: str = Field(..., min_length=1, max_length=128)
    resource_type: str = Field(..., min_length=1, max_length=64)
    resource_id: str = Field(..., min_length=1, max_length=200)
    scope: str = Field(..., min_length=1, max_length=32)
    roles: list[str] = Field(default_factory=list)


class WhiteLabelUpdateRequest(BaseModel):
    brand_name: str | None = Field(default=None, max_length=120)
    brand_logo_url: str | None = Field(default=None, max_length=1000)
    brand_favicon_url: str | None = Field(default=None, max_length=1000)
    brand_primary_color: str | None = Field(default=None, max_length=16)
    brand_secondary_color: str | None = Field(default=None, max_length=16)
    brand_bg_color: str | None = Field(default=None, max_length=16)
    brand_text_color: str | None = Field(default=None, max_length=16)
    custom_domain: str | None = Field(default=None, max_length=255)
    login_slogan: str | None = Field(default=None, max_length=300)
    login_bg_image_url: str | None = Field(default=None, max_length=1000)
    support_email: str | None = Field(default=None, max_length=255)
    support_phone: str | None = Field(default=None, max_length=64)
    hide_powered_by: bool | None = None
    email_from_name: str | None = Field(default=None, max_length=120)
    email_from_address: str | None = Field(default=None, max_length=255)


class WhiteLabelLogoUploadRequest(BaseModel):
    filename: str = Field(default="logo.png", min_length=1, max_length=255)
    content_base64: str = Field(..., min_length=1)


class LobsterExecuteRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    industry: str | None = Field(default=None, min_length=1, max_length=120)
    industry_tag: str | None = Field(default=None, min_length=1, max_length=120)
    session_mode: str = Field(default="per-peer", pattern="^(shared|per-peer|isolated)$")
    peer_id: str | None = Field(default=None, max_length=128)
    fresh_context: bool = False
    execution_mode: str = Field(default="auto", pattern="^(foreground|background|auto)$")
    enable_output_validation: bool = False
    auto_retry_on_violation: bool = False
    reply_channel_id: str | None = Field(default=None, max_length=128)
    reply_chat_id: str | None = Field(default=None, max_length=128)


class VoiceSynthesizeRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=10000)
    lobster_id: str = Field(default="visualizer", min_length=1, max_length=64)
    run_id: str = Field(default="voice_preview", min_length=1, max_length=128)
    voice_mode: str = Field(default="standard", min_length=1, max_length=64)
    voice_prompt: str | None = Field(default=None, max_length=1000)
    voice_profile_id: str | None = Field(default=None, max_length=128)
    voice_profile: dict[str, Any] = Field(default_factory=dict)
    subtitle_required: bool = Field(default=False)
    step_index: int | None = Field(default=None, ge=0, le=10000)
    triggered_by: str | None = Field(default=None, max_length=128)
    meta: dict[str, Any] = Field(default_factory=dict)


class VoiceProfileCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=160)
    owner_type: str = Field(..., min_length=1, max_length=64)
    reference_audio_path: str = Field(..., min_length=1, max_length=2000)
    voice_prompt: str | None = Field(default=None, max_length=2000)
    language: str = Field(default="zh", min_length=2, max_length=16)
    sample_rate: int = Field(default=48000, ge=16000, le=48000)
    consent_doc_id: str | None = Field(default=None, max_length=128)
    clone_enabled: bool = False
    tags: list[str] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)


class VoiceConsentCreateRequest(BaseModel):
    owner_name: str = Field(..., min_length=1, max_length=160)
    owner_type: str = Field(..., min_length=1, max_length=64)
    consent_doc_id: str = Field(..., min_length=1, max_length=128)
    scope: str = Field(..., min_length=1, max_length=128)
    reference_audio_path: str = Field(..., min_length=1, max_length=2000)
    notes: str | None = Field(default=None, max_length=1000)
    meta: dict[str, Any] = Field(default_factory=dict)


class VoiceReviewActionRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class SkillStatusPatchRequest(BaseModel):
    status: str = Field(..., min_length=1, max_length=32)
    note: str | None = Field(default=None, max_length=1000)


class SkillRegisterRequest(BaseModel):
    manifest: dict[str, Any] = Field(default_factory=dict)
    files: list[str] = Field(default_factory=list)
    system_prompt: str | None = Field(default=None, max_length=50000)
    user_template: str | None = Field(default=None, max_length=50000)
    persist: bool = False


class LlmAgentBindingUpdateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool = True
    task_type: str = Field(default="", max_length=64)
    provider_id: str = Field(..., min_length=1, max_length=64)
    model_name: str = Field(default="", max_length=120)
    temperature: float = Field(default=0.3, ge=0.0, le=2.0)
    max_tokens: int = Field(default=0, ge=0, le=65535)
    note: str | None = Field(default=None, max_length=300)


class AgentExtensionProfileUpdateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    enabled: bool = True
    profile_version: str = Field(default="openclaw-native-v1", min_length=1, max_length=64)
    runtime_mode: str = Field(default="hybrid", pattern="^(local|cloud|hybrid)$")
    role_prompt: str = Field(default="", max_length=4000)
    skills: list[dict[str, Any]] = Field(default_factory=list)
    nodes: list[dict[str, Any]] = Field(default_factory=list)
    hooks: dict[str, Any] = Field(default_factory=dict)
    limits: dict[str, Any] = Field(default_factory=dict)
    tags: list[str] = Field(default_factory=list)


class BillingCheckoutIntentRequest(BaseModel):
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    plan_code: str = Field(default="pro", min_length=1, max_length=32)
    cycle: str = Field(default="month", min_length=1, max_length=16)
    provider: str | None = Field(default=None, min_length=1, max_length=32)
    return_url: str | None = Field(default=None, max_length=1000)


class BillingTrialActivateRequest(BaseModel):
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    plan_code: str = Field(default="pro", min_length=1, max_length=32)
    duration_days: int = Field(default=14, ge=1, le=60)


class BillingProviderWebhookRequest(BaseModel):
    provider: str | None = Field(default=None, min_length=1, max_length=32)
    event_id: str | None = Field(default=None, max_length=128)
    action: str | None = Field(default=None, max_length=128)
    user_id: str | None = Field(default=None, max_length=128)
    tenant_id: str | None = Field(default=None, max_length=128)
    order_id: str | None = Field(default=None, max_length=64)
    checkout_id: str | None = Field(default=None, max_length=64)
    provider_subscription_id: str | None = Field(default=None, max_length=128)
    payload: dict[str, Any] = Field(default_factory=dict)
    signature: str | None = Field(default=None, max_length=300)


class BillingReconcileRequest(BaseModel):
    provider: str | None = Field(default=None, min_length=1, max_length=32)
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    stale_minutes: int = Field(default=30, ge=5, le=7 * 24 * 60)
    lookback_days: int = Field(default=30, ge=1, le=365)


class BillingCompensationResolveRequest(BaseModel):
    status: str = Field(default="resolved", min_length=1, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)


class SeatSubscriptionCreateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    seat_count: int = Field(default=1, ge=1, le=5000)
    billing_cycle: str = Field(default="monthly", pattern="^(monthly|annual)$")
    agent_id: str | None = Field(default=None, max_length=128)
    trial_days: int = Field(default=14, ge=1, le=30)


class SeatSubscriptionCheckoutRequest(BaseModel):
    provider: str = Field(default="wechatpay", min_length=1, max_length=32)
    return_url: str | None = Field(default=None, max_length=1000)


class SeatSubscriptionUpgradeRequest(BaseModel):
    new_seat_count: int = Field(..., ge=1, le=5000)


class SeatQuotaConsumeRequest(BaseModel):
    seat_id: str = Field(..., min_length=1, max_length=200)
    resource: str = Field(..., min_length=1, max_length=64)
    amount: int = Field(default=1, ge=1, le=1000)
    trace_id: str | None = Field(default=None, max_length=128)
    source: str = Field(default="api", min_length=1, max_length=64)


class PartnerAgentRegisterRequest(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=160)
    contact_name: str = Field(..., min_length=1, max_length=80)
    contact_phone: str = Field(..., min_length=1, max_length=64)
    contact_wechat: str | None = Field(default=None, max_length=80)
    city: str = Field(..., min_length=1, max_length=80)
    province: str = Field(..., min_length=1, max_length=80)
    seat_count: int = Field(..., ge=20, le=5000)
    white_label_brand_name: str | None = Field(default=None, max_length=120)


class PartnerSeatAssignRequest(BaseModel):
    tenant_id: str = Field(..., min_length=1, max_length=128)
    seat_id: str = Field(..., min_length=1, max_length=200)
    seat_name: str = Field(..., min_length=1, max_length=160)
    platform: str = Field(..., min_length=1, max_length=64)
    account_username: str = Field(default="", max_length=120)
    client_name: str = Field(default="", max_length=160)


class PartnerSeatUpgradeRequest(BaseModel):
    seat_count: int = Field(..., ge=20, le=5000)


class PartnerWhiteLabelUpdateRequest(BaseModel):
    brand_name: str = Field(..., min_length=1, max_length=120)
    logo_url: str | None = Field(default=None, max_length=1000)
    primary_color: str = Field(default="#0ea5e9", max_length=20)
    lobster_names: dict[str, str] = Field(default_factory=dict)


class PartnerSubAgentCreateRequest(BaseModel):
    company_name: str = Field(..., min_length=1, max_length=160)
    contact_name: str = Field(..., min_length=1, max_length=80)
    region: str = Field(..., min_length=1, max_length=120)
    allocated_seats: int = Field(..., ge=1, le=5000)


class PartnerStatementConfirmRequest(BaseModel):
    confirmed_by: str = Field(..., min_length=1, max_length=120)


class PartnerStatementDisputeRequest(BaseModel):
    reason: str = Field(..., min_length=1, max_length=1000)


class NotificationTestRequest(BaseModel):
    target: str = Field(..., min_length=1, max_length=300)
    text: str = Field(default="Lobster Pool notification channel test", min_length=1, max_length=2000)


class ResearchSignalManualInput(BaseModel):
    source: str = Field(default="manual", min_length=1, max_length=64)
    rank_type: str = Field(default="manual", min_length=1, max_length=32)
    title: str = Field(..., min_length=1, max_length=300)
    url: str = Field(..., min_length=1, max_length=1000)
    summary: str = Field(default="", max_length=4000)
    tags: list[str] = Field(default_factory=list)
    score: float | None = Field(default=None)
    credibility: float | None = Field(default=None)
    actionability: float | None = Field(default=None)
    published_at: str | None = Field(default=None, max_length=64)
    raw: dict[str, Any] = Field(default_factory=dict)


class ResearchIngestManualRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    signals: list[ResearchSignalManualInput] = Field(default_factory=list)


class ResearchRefreshRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    sources: list[str] = Field(default_factory=lambda: ["openalex", "github_projects", "huggingface_papers", "qbitai"])
    trigger_type: str = Field(default="manual", min_length=1, max_length=32)


class ResearchDigestFeishuRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    chat_id: str | None = Field(default=None, max_length=128)
    source: str | None = Field(default=None, max_length=64)
    rank_type: str | None = Field(default=None, max_length=32)
    limit: int = Field(default=20, ge=1, le=50)
    only_executable: bool = Field(default=True)


class IndustryKbProfileUpsertRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    industry_tag: str = Field(..., min_length=1, max_length=64)
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    status: str = Field(default="active", min_length=1, max_length=16)
    config: dict[str, Any] = Field(default_factory=dict)


class IndustryKbBootstrapRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    force: bool = Field(default=False)
    selected_industry_tag: str | None = Field(default=None, min_length=1, max_length=64)


class IndustryStarterKitGenerateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    industry_tag: str = Field(..., min_length=1, max_length=64)
    force: bool = Field(default=False)
    max_tasks: int = Field(default=12, ge=1, le=50)


class IndustryKbGenerateProfileRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    industry_tag: str = Field(..., min_length=1, max_length=64)
    industry_name: str | None = Field(default=None, min_length=1, max_length=120)
    base_profile: dict[str, Any] = Field(default_factory=dict)
    base_profile_json_path: str | None = Field(default=None, max_length=500)
    system_prompt_path: str | None = Field(default=None, max_length=500)
    max_retries: int = Field(default=3, ge=1, le=8)
    seed_to_kb: bool = Field(default=True)
    trace_id: str | None = Field(default=None, max_length=128)


class IndustryKbBulkSeedRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    actor_user_id: str | None = Field(default=None, min_length=1, max_length=128)
    base_profile: dict[str, Any] = Field(default_factory=dict)
    base_profile_json_path: str | None = Field(default=None, max_length=500)
    prompt_template_path: str | None = Field(default=None, max_length=500)
    selected_industry_tags: list[str] = Field(default_factory=list)


class AgentRagGenerateRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    profile: str = Field(default="feedback", min_length=1, max_length=32)
    agent_id: str = Field(..., min_length=1, max_length=64)
    knowledge_pack_id: str = Field(..., min_length=1, max_length=128)
    model_name: str | None = Field(default=None, max_length=120)
    max_retries: int = Field(default=3, ge=1, le=8)
    system_prompt_path: str | None = Field(default=None, max_length=500)
    persist: bool = Field(default=True)
    trace_id: str | None = Field(default=None, max_length=128)


class IndustryKbIngestEntry(BaseModel):
    entry_type: str = Field(default="formula", min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=160)
    content: str = Field(..., min_length=1, max_length=20000)
    source_url: str | None = Field(default=None, max_length=1000)
    source_account: str | None = Field(default=None, max_length=120)
    effect_score: float = Field(default=0.0, ge=0.0, le=100.0)
    metadata: dict[str, Any] = Field(default_factory=dict)


class IndustryKbIngestRequest(BaseModel):
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    industry_tag: str = Field(..., min_length=1, max_length=64)
    trace_id: str | None = Field(default=None, max_length=128)
    entries: list[IndustryKbIngestEntry] = Field(default_factory=list)


class IndustryKbDissectIngestRequest(BaseModel):
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    tenant_id: str | None = Field(default=None, min_length=1, max_length=128)
    industry_tag: str | None = Field(default=None, min_length=1, max_length=64)
    competitor_accounts: list[str] = Field(default_factory=list, min_length=1, max_length=20)
    report_to_feishu: bool = Field(default=True)
    feishu_chat_id: str | None = Field(default=None, max_length=128)


class IndustryKbDissectIngestResponse(BaseModel):
    ok: bool
    trace_id: str
    thread_id: str
    user_id: str
    tenant_id: str
    industry_tag: str
    account_dissect_node: dict[str, Any] = Field(default_factory=dict)
    formulas_count: int = 0
    startup_playbooks_count: int = 0
    copy_templates_count: int = 0
    kb_ingested_count: int = 0
    kb_rejected_count: int = 0
    kb_duplicate_count: int = 0
    feishu_push_status: str = "skipped"
    feishu_push_detail: dict[str, Any] = Field(default_factory=dict)
    report_markdown: str = ""
    call_log: list[Any] = Field(default_factory=list)


class FeishuTestRequest(BaseModel):
    message: str = Field(default="✅ 龙虾元老院：飞书通道联调成功", min_length=1, max_length=2000)
    chat_id: str | None = Field(default=None, max_length=128)


class ClawTeamWorkerHeartbeatRequest(BaseModel):
    trace_id: str = Field(..., min_length=1, max_length=128)
    worker_id: str = Field(..., min_length=1, max_length=128)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    lanes: list[str] = Field(default_factory=list)
    status: str = Field(default="idle", min_length=1, max_length=32)
    meta: dict[str, Any] = Field(default_factory=dict)


class ClawTeamWorkerClaimRequest(BaseModel):
    trace_id: str = Field(..., min_length=1, max_length=128)
    worker_id: str = Field(..., min_length=1, max_length=128)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    lanes: list[str] = Field(default_factory=list)
    limit: int = Field(default=20, ge=1, le=200)


class ClawTeamWorkerAckRequest(BaseModel):
    trace_id: str = Field(..., min_length=1, max_length=128)
    worker_id: str = Field(..., min_length=1, max_length=128)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    completed_task_keys: list[str] = Field(default_factory=list)
    failed_task_keys: list[str] = Field(default_factory=list)
    error: str | None = Field(default=None, max_length=600)


class ClawTeamRequeueRequest(BaseModel):
    trace_id: str = Field(..., min_length=1, max_length=128)
    user_id: str | None = Field(default=None, min_length=1, max_length=128)
    stale_after_sec: int = Field(default=180, ge=30, le=86400)
    max_attempt_count: int = Field(default=5, ge=1, le=100)


def _bool_env(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _billing_guard_enabled() -> bool:
    return _bool_env("BILLING_GUARD_ENABLED", True)


def _billing_guarded_paths() -> set[str]:
    raw = os.getenv(
        "BILLING_GUARDED_PATHS",
        "/run-dragon-team,/analyze_competitor_formula,/receive_dm_from_edge",
    ).strip()
    values = [item.strip() for item in raw.split(",") if item.strip()]
    return set(values)


def _billing_plan_prices() -> dict[str, dict[str, int]]:
    return {
        "free": {
            "month": 0,
            "year": 0,
        },
        "pro": {
            "month": int(os.getenv("PLAN_PRO_PRICE_MONTH_CNY", "499")),
            "year": int(os.getenv("PLAN_PRO_PRICE_YEAR_CNY", "4990")),
        },
        "enterprise": {
            "month": int(os.getenv("PLAN_ENTERPRISE_PRICE_MONTH_CNY", "4999")),
            "year": int(os.getenv("PLAN_ENTERPRISE_PRICE_YEAR_CNY", "49990")),
        },
    }


def _billing_plan_amount_cny(plan_code: str, cycle: str) -> tuple[str, str, int]:
    catalog = _billing_plan_prices()
    safe_plan = str(plan_code or "free").strip().lower()
    safe_cycle = str(cycle or "month").strip().lower()
    if safe_plan not in catalog:
        safe_plan = "free"
    if safe_cycle not in {"month", "year"}:
        safe_cycle = "month"
    amount = int(catalog.get(safe_plan, {}).get(safe_cycle, 0))
    return safe_plan, safe_cycle, max(0, amount)


def _billing_action_from_plan(plan_code: str) -> str:
    safe_plan = str(plan_code or "free").strip().lower()
    if safe_plan not in {"free", "pro", "enterprise"}:
        safe_plan = "free"
    return f"upgrade_{safe_plan}"


def _billing_map_provider_event_to_action(event_name: str | None, *, fallback_plan_code: str = "pro") -> str:
    safe = str(event_name or "").strip().lower().replace(" ", "_")
    if not safe:
        return "payment_succeeded"
    mapping = {
        "checkout.session.completed": "payment_succeeded",
        "payment_succeeded": "payment_succeeded",
        "paid": "payment_succeeded",
        "charge.succeeded": "payment_succeeded",
        "invoice.paid": "payment_succeeded",
        "invoice.payment_failed": "payment_failed",
        "payment_failed": "payment_failed",
        "customer.subscription.deleted": "canceled",
        "cancel": "canceled",
        "canceled": "canceled",
        "resume": "resume",
        "past_due": "past_due",
        "activate": "activate",
    }
    if safe.startswith("upgrade_"):
        return safe
    if safe.startswith("downgrade_"):
        return safe
    if safe in mapping:
        return mapping[safe]
    if safe.startswith("plan_changed_"):
        suffix = safe.replace("plan_changed_", "", 1).strip("_")
        if suffix in {"free", "pro", "enterprise"}:
            return f"upgrade_{suffix}"
    return _billing_action_from_plan(fallback_plan_code)


def _estimate_tokens_from_payload(payload: Any) -> int:
    try:
        blob = json.dumps(payload, ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        blob = str(payload)
    return max(1, len(blob) // 4)


def _remember_event(
    *,
    user_id: str,
    trace_id: str | None,
    node: str,
    event_type: str,
    payload: dict[str, Any],
    level: str = "info",
) -> None:
    try:
        append_lossless_event(
            user_id=user_id,
            trace_id=trace_id,
            node=node,
            event_type=event_type,
            payload=payload,
            level=level,
        )
    except Exception:  # noqa: BLE001
        pass


def _kernel_enabled() -> bool:
    return _bool_env("SENATE_KERNEL_ENABLED", True)


def _kernel_grey_ratio() -> float:
    raw = os.getenv("SENATE_KERNEL_GREY_RATIO", "100").strip()
    try:
        return max(0.0, min(float(raw), 100.0))
    except ValueError:
        return 100.0


def _kernel_block_mode() -> str:
    mode = os.getenv("SENATE_KERNEL_BLOCK_MODE", "hitl").strip().lower()
    if mode not in {"hitl", "deny"}:
        return "hitl"
    return mode


def _kernel_default_risk_rollout() -> dict[str, dict[str, Any]]:
    defaults: dict[str, dict[str, Any]] = {
        "P0": {"rollout_ratio": 5.0, "strategy_version": "strict_v1", "block_mode": "deny"},
        "P1": {"rollout_ratio": 25.0, "strategy_version": "guarded_v1", "block_mode": "hitl"},
        "P2": {"rollout_ratio": 60.0, "strategy_version": "balanced_v1", "block_mode": "hitl"},
        "P3": {"rollout_ratio": 100.0, "strategy_version": "explore_v1", "block_mode": "hitl"},
    }
    raw = os.getenv("SENATE_KERNEL_RISK_ROLLOUT_JSON", "").strip()
    if not raw:
        return defaults
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return defaults
    if not isinstance(parsed, dict):
        return defaults
    return _kernel_normalize_risk_rollout(parsed, fallback=defaults)


def _kernel_normalize_risk_rollout(
    raw: dict[str, Any] | None,
    *,
    fallback: dict[str, dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    base = fallback or _kernel_default_risk_rollout()
    output: dict[str, dict[str, Any]] = {}
    payload = raw if isinstance(raw, dict) else {}
    for risk_level, cfg in base.items():
        normalized_cfg = dict(cfg)
        incoming = payload.get(risk_level)
        if isinstance(incoming, (int, float, str)):
            try:
                normalized_cfg["rollout_ratio"] = max(0.0, min(float(incoming), 100.0))
            except ValueError:
                pass
        elif isinstance(incoming, dict):
            ratio_raw = incoming.get("rollout_ratio")
            if isinstance(ratio_raw, (int, float, str)):
                try:
                    normalized_cfg["rollout_ratio"] = max(0.0, min(float(ratio_raw), 100.0))
                except ValueError:
                    pass
            strategy_version = str(incoming.get("strategy_version") or normalized_cfg.get("strategy_version") or "v1")
            normalized_cfg["strategy_version"] = strategy_version
            block_mode = str(incoming.get("block_mode") or normalized_cfg.get("block_mode") or "hitl").lower().strip()
            if block_mode in {"hitl", "deny"}:
                normalized_cfg["block_mode"] = block_mode
        normalized_cfg["rollout_ratio"] = max(0.0, min(float(normalized_cfg.get("rollout_ratio", 100.0)), 100.0))
        if str(normalized_cfg.get("block_mode", "hitl")).lower() not in {"hitl", "deny"}:
            normalized_cfg["block_mode"] = "hitl"
        output[risk_level] = normalized_cfg
    return output


def _normalize_template_key(value: str | None, fallback_name: str) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        raw = fallback_name.strip().lower()
    key = re.sub(r"[^a-z0-9_-]+", "-", raw).strip("-")
    if not key:
        key = f"template-{uuid.uuid4().hex[:8]}"
    return key[:64]


def _kernel_classify_risk_level(
    *,
    task_description: str,
    competitor_handles: list[str] | None = None,
    edge_targets: list[dict[str, Any]] | None = None,
) -> str:
    text = f"{task_description} {' '.join(competitor_handles or [])}".lower()
    edge_count = len(edge_targets or [])
    p0_keywords = ("全自动", "批量", "私信", "冷启动", "电销", "外呼", "秒发", "绕过", "风控")
    p1_keywords = ("发布", "分发", "评论", "带节奏", "引流", "任务下发", "节点执行")
    p3_keywords = ("调研", "分析", "仿真", "预演", "测试", "草稿", "复盘")
    if edge_count >= 10 or any(k in text for k in p0_keywords):
        return "P0"
    if edge_count >= 5 or any(k in text for k in p1_keywords):
        return "P1"
    if any(k in text for k in p3_keywords):
        return "P3"
    return "P2"


def _kernel_rollout_bucket(seed: str) -> float:
    digest = hashlib.sha256(seed.encode("utf-8")).hexdigest()
    # 0.00 - 99.99 deterministic bucket
    return (int(digest[:8], 16) % 10000) / 100.0


def _kernel_tenant_allowed(tenant_id: str) -> bool:
    raw = os.getenv("SENATE_KERNEL_TENANT_ALLOWLIST", "").strip()
    if not raw:
        return True
    allow = {x.strip() for x in raw.split(",") if x.strip()}
    return tenant_id in allow


def _kernel_policy_for_tenant(tenant_id: str) -> dict[str, Any]:
    persisted = memory_get_kernel_rollout_policy(tenant_id) or {}
    enabled_default = _kernel_enabled()
    ratio_default = _kernel_grey_ratio()
    mode_default = _kernel_block_mode()
    risk_default = _kernel_default_risk_rollout()
    risk_persisted = persisted.get("risk_rollout") if isinstance(persisted.get("risk_rollout"), dict) else None
    policy = {
        "tenant_id": tenant_id,
        "enabled": bool(persisted.get("enabled", enabled_default)),
        "rollout_ratio": float(persisted.get("rollout_ratio", ratio_default) or ratio_default),
        "block_mode": str(persisted.get("block_mode", mode_default) or mode_default),
        "risk_rollout": _kernel_normalize_risk_rollout(risk_persisted, fallback=risk_default),
        "window_start_utc": persisted.get("window_start_utc"),
        "window_end_utc": persisted.get("window_end_utc"),
        "note": persisted.get("note"),
        "updated_by": persisted.get("updated_by"),
        "updated_at": persisted.get("updated_at"),
        "source": "db" if persisted else "env_default",
    }
    policy["rollout_ratio"] = max(0.0, min(float(policy["rollout_ratio"]), 100.0))
    if policy["block_mode"] not in {"hitl", "deny"}:
        policy["block_mode"] = "hitl"
    return policy


def _kernel_window_active(policy: dict[str, Any], *, now: datetime | None = None) -> bool:
    now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    start = _parse_dt(policy.get("window_start_utc"))
    end = _parse_dt(policy.get("window_end_utc"))
    if start and now_utc < start:
        return False
    if end and now_utc > end:
        return False
    return True


def _kernel_should_apply(
    *,
    tenant_id: str,
    request_id: str,
    risk_level: str = "P2",
) -> tuple[bool, dict[str, Any]]:
    policy = _kernel_policy_for_tenant(tenant_id)
    normalized_risk = str(risk_level or "P2").upper().strip()
    if normalized_risk not in {"P0", "P1", "P2", "P3"}:
        normalized_risk = "P2"
    policy["risk_level"] = normalized_risk
    if not bool(policy.get("enabled", True)):
        return False, policy
    if not _kernel_tenant_allowed(tenant_id):
        policy["allowlist_blocked"] = True
        return False, policy
    if not _kernel_window_active(policy):
        policy["window_inactive"] = True
        return False, policy
    risk_rollout = policy.get("risk_rollout") if isinstance(policy.get("risk_rollout"), dict) else {}
    risk_cfg = risk_rollout.get(normalized_risk, {}) if isinstance(risk_rollout, dict) else {}
    ratio = float(risk_cfg.get("rollout_ratio", policy.get("rollout_ratio", 100.0)) or 100.0)
    ratio = max(0.0, min(ratio, 100.0))
    bucket = _kernel_rollout_bucket(request_id)
    hit = bucket <= ratio
    policy["risk_level"] = normalized_risk
    policy["strategy_version"] = str(risk_cfg.get("strategy_version") or "default")
    policy["effective_rollout_ratio"] = ratio
    policy["effective_block_mode"] = str(risk_cfg.get("block_mode") or policy.get("block_mode") or "hitl").lower()
    policy["bucket"] = bucket
    policy["bucket_hit"] = hit
    return hit, policy


def _kernel_effective_block_mode(policy: dict[str, Any]) -> str:
    mode = str(policy.get("effective_block_mode") or policy.get("block_mode", "hitl") or "hitl").lower().strip()
    return mode if mode in {"hitl", "deny"} else "hitl"


def _kernel_autonomy_snapshot(
    *,
    guardian: dict[str, Any],
    verification: dict[str, Any],
    block_mode: str,
    hitl_required: bool = False,
    hitl_decision: str | None = None,
    request_started_at: str | None = None,
    decision_updated_at: str | None = None,
) -> dict[str, Any]:
    guardian_decision = str(guardian.get("decision", "review") or "review").strip().lower()
    verification_accepted = bool(verification.get("accepted", False))
    normalized_block_mode = str(block_mode or "hitl").strip().lower()
    route = "review_required"
    if guardian_decision == "block" and normalized_block_mode == "deny":
        route = "auto_block"
    elif guardian_decision == "allow" and verification_accepted and not hitl_required:
        route = "auto_pass"

    approval_required = route == "review_required" or bool(hitl_required)
    normalized_decision = str(hitl_decision or "").strip().lower()
    approval_resolved = normalized_decision in {"approved", "rejected", "executed", "executed_approved", "denied"}

    approval_latency_sec: float | None = None
    started_at = _parse_dt(request_started_at)
    decided_at = _parse_dt(decision_updated_at)
    if approval_required and approval_resolved and started_at and decided_at and decided_at >= started_at:
        approval_latency_sec = round((decided_at - started_at).total_seconds(), 2)

    return {
        "route": route,
        "approval_required": approval_required,
        "approval_resolved": approval_resolved,
        "approval_decision": normalized_decision or None,
        "approval_latency_sec": approval_latency_sec,
        "guardian_decision": guardian_decision,
        "verification_accepted": verification_accepted,
    }


def _kernel_preflight_report(
    *,
    tenant_id: str,
    user_id: str,
    request_id: str,
    task_description: str,
    competitor_handles: list[str],
    edge_target_count: int = 0,
    kernel_policy: dict[str, Any] | None = None,
) -> dict[str, Any]:
    radar_seed = {
        "sources": ["openalex", "github_projects", "huggingface_papers"],
        "source_signals": competitor_handles[:6],
        "platforms": ["xiaohongshu", "douyin"],
    }
    source_credibility = kernel_compute_source_credibility(radar_seed)
    memory_context = kernel_build_memory_context(
        tenant_id=tenant_id,
        user_id=user_id,
        task_description=task_description,
        hot_topics=competitor_handles[:4],
    )
    confidence = kernel_estimate_strategy_confidence(
        rag_reference_count=0,
        rag_graph_reference_count=0,
        llm_route="rule_only",
        llm_error=None,
        source_overall=float(source_credibility.get("overall", 0.5)),
        memory_coverage=float(memory_context.get("coverage", 0.0)),
    )
    pre_strategy = {
        "strategy_summary": task_description[:240],
        "primary_topics": competitor_handles[:3],
        "stage": "preflight",
    }
    guardian = kernel_constitutional_guardian(
        task_description=task_description,
        strategy=pre_strategy,
        source_credibility=source_credibility,
        memory_context=memory_context,
    )
    verification = kernel_verification_gate(
        confidence=confidence,
        guardian=guardian,
        source_credibility=source_credibility,
    )
    risk_taxonomy = kernel_classify_risk_taxonomy(
        task_description=task_description,
        strategy=pre_strategy,
        guardian=guardian,
        verification=verification,
        edge_target_count=edge_target_count,
        competitor_count=len(competitor_handles),
    )
    block_mode = _kernel_effective_block_mode(kernel_policy or _kernel_policy_for_tenant(tenant_id))
    autonomy = _kernel_autonomy_snapshot(
        guardian=guardian,
        verification=verification,
        block_mode=block_mode,
        hitl_required=False,
        hitl_decision=None,
        request_started_at=datetime.now(timezone.utc).isoformat(),
        decision_updated_at=None,
    )
    persisted = kernel_persist_memory(
        tenant_id=tenant_id,
        user_id=user_id,
        trace_id=request_id,
        task_description=task_description,
        strategy=pre_strategy,
        guardian=guardian,
        verification=verification,
        confidence=confidence,
    )
    return {
        "stage": "preflight",
        "request_id": request_id,
        "tenant_id": tenant_id,
        "user_id": user_id,
        "task_description": task_description,
        "competitor_handles": competitor_handles[:12],
        "kernel_policy": kernel_policy or _kernel_policy_for_tenant(tenant_id),
        "source_credibility": source_credibility,
        "memory_context": {
            "coverage": memory_context.get("coverage", 0.0),
            "episode_count": memory_context.get("episode_count", 0),
            "policy_count": memory_context.get("policy_count", 0),
            "tenant_memory_count": memory_context.get("tenant_memory_count", 0),
        },
        "confidence": confidence,
        "guardian": guardian,
        "verification": verification,
        "risk_taxonomy": risk_taxonomy,
        "autonomy": autonomy,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "block_mode": block_mode,
        "persisted": persisted,
    }


def _persist_kernel_report(
    *,
    tenant_id: str,
    user_id: str,
    trace_id: str,
    stage: str,
    report: dict[str, Any],
) -> dict[str, Any]:
    try:
        return memory_upsert_kernel_report(
            tenant_id=tenant_id,
            user_id=user_id,
            trace_id=trace_id,
            stage=stage,
            report=report,
        )
    except Exception as exc:  # noqa: BLE001
        return {"inserted": False, "error": str(exc)}


def _kernel_alert_signals(
    *,
    tenant_id: str,
    metrics: dict[str, Any],
) -> dict[str, Any]:
    totals = metrics.get("totals", {}) if isinstance(metrics.get("totals"), dict) else {}
    by_risk_family = metrics.get("byRiskFamily", {}) if isinstance(metrics.get("byRiskFamily"), dict) else {}
    total_reports = max(1, int(totals.get("kernel_reports_total", 0) or 0))
    review_required = int(totals.get("review_required_count", 0) or 0)
    auto_block = int(totals.get("auto_block_count", 0) or 0)
    approval_required = int(totals.get("approval_required_count", 0) or 0)
    approval_resolved = int(totals.get("approval_resolved_count", 0) or 0)
    approval_backlog = max(0, approval_required - approval_resolved)
    average_approval_latency_sec = float(totals.get("average_approval_latency_sec", 0.0) or 0.0)

    review_ratio = round(review_required / total_reports, 4)
    auto_block_ratio = round(auto_block / total_reports, 4)
    single_agent_ratio = round(float(by_risk_family.get("single_agent", 0) or 0) / total_reports, 4)
    inter_agent_ratio = round(float(by_risk_family.get("inter_agent", 0) or 0) / total_reports, 4)
    system_emergent_ratio = round(float(by_risk_family.get("system_emergent", 0) or 0) / total_reports, 4)

    signals = []
    signals.append(
        {
            "rule_key": "single_agent.review_required_ratio",
            "family": "single_agent",
            "severity": "P2",
            "state": "fired" if review_ratio >= 0.25 else "ok",
            "value": review_ratio,
            "threshold": 0.25,
            "message": (
                f"single-agent review ratio {review_ratio:.2f} exceeds threshold"
                if review_ratio >= 0.25
                else f"single-agent review ratio healthy ({review_ratio:.2f})"
            ),
            "recommended_action": "tighten prompt/policy guardrails and sample recent outputs",
        }
    )
    signals.append(
        {
            "rule_key": "single_agent.auto_block_ratio",
            "family": "single_agent",
            "severity": "P1",
            "state": "fired" if auto_block_ratio >= 0.08 else "ok",
            "value": auto_block_ratio,
            "threshold": 0.08,
            "message": (
                f"auto-block ratio {auto_block_ratio:.2f} exceeds threshold"
                if auto_block_ratio >= 0.08
                else f"auto-block ratio healthy ({auto_block_ratio:.2f})"
            ),
            "recommended_action": "pause affected template lane and inspect blocked terms",
        }
    )
    signals.append(
        {
            "rule_key": "inter_agent.family_presence_ratio",
            "family": "inter_agent",
            "severity": "P2",
            "state": "fired" if inter_agent_ratio >= 0.20 else "ok",
            "value": inter_agent_ratio,
            "threshold": 0.20,
            "message": (
                f"inter-agent risk family ratio {inter_agent_ratio:.2f} exceeds threshold"
                if inter_agent_ratio >= 0.20
                else f"inter-agent risk family healthy ({inter_agent_ratio:.2f})"
            ),
            "recommended_action": "switch to phased rollout and validate queue/edge handoffs",
        }
    )
    signals.append(
        {
            "rule_key": "system_emergent.approval_backlog",
            "family": "system_emergent",
            "severity": "P1",
            "state": "fired" if approval_backlog >= 5 else "ok",
            "value": approval_backlog,
            "threshold": 5,
            "message": (
                f"approval backlog {approval_backlog} exceeds threshold"
                if approval_backlog >= 5
                else f"approval backlog healthy ({approval_backlog})"
            ),
            "recommended_action": "reduce rollout ratio and push mobile approval notifications",
        }
    )
    signals.append(
        {
            "rule_key": "system_emergent.approval_latency",
            "family": "system_emergent",
            "severity": "P2",
            "state": "fired" if average_approval_latency_sec >= 180 else "ok",
            "value": round(average_approval_latency_sec, 2),
            "threshold": 180,
            "message": (
                f"approval latency {average_approval_latency_sec:.1f}s exceeds threshold"
                if average_approval_latency_sec >= 180
                else f"approval latency healthy ({average_approval_latency_sec:.1f}s)"
            ),
            "recommended_action": "use mobile approval loop and reduce review-required paths",
        }
    )
    signals.append(
        {
            "rule_key": "system_emergent.family_presence_ratio",
            "family": "system_emergent",
            "severity": "P1",
            "state": "fired" if system_emergent_ratio >= 0.15 else "ok",
            "value": system_emergent_ratio,
            "threshold": 0.15,
            "message": (
                f"system-emergent risk family ratio {system_emergent_ratio:.2f} exceeds threshold"
                if system_emergent_ratio >= 0.15
                else f"system-emergent risk family healthy ({system_emergent_ratio:.2f})"
            ),
            "recommended_action": "disable burst lanes and force HITL on high-risk actions",
        }
    )

    fired = [signal for signal in signals if signal["state"] == "fired"]
    return {
        "tenant_id": tenant_id,
        "count": len(signals),
        "fired_count": len(fired),
        "signals": signals,
        "totals": {
            "kernel_reports_total": total_reports,
            "single_agent_ratio": single_agent_ratio,
            "inter_agent_ratio": inter_agent_ratio,
            "system_emergent_ratio": system_emergent_ratio,
            "approval_backlog": approval_backlog,
            "approval_latency_sec": round(average_approval_latency_sec, 2),
        },
    }


def _extract_approval_journal(replay: dict[str, Any]) -> list[dict[str, Any]]:
    timeline = replay.get("timeline", []) if isinstance(replay, dict) else []
    rows: list[dict[str, Any]] = []
    for event in timeline:
        if not isinstance(event, dict):
            continue
        node = str(event.get("node") or "")
        event_type = str(event.get("event_type") or "")
        payload = event.get("payload", {}) if isinstance(event.get("payload"), dict) else {}
        is_hitl = (
            node == "human_approval_gate"
            or "hitl" in event_type.lower()
            or "approval" in event_type.lower()
            or "hitl" in node.lower()
        )
        if not is_hitl:
            continue
        rows.append(
            {
                "ts": event.get("ts"),
                "node": node,
                "event_type": event_type,
                "level": event.get("level"),
                "decision": payload.get("decision") or payload.get("hitl_decision"),
                "reason": payload.get("reason") or payload.get("hitl_reason"),
                "approval_id": payload.get("approval_id") or payload.get("hitl_approval_id"),
            }
        )
    return rows


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    text = raw.strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _webhook_replay_window_sec() -> int:
    raw = os.getenv("CHAT_WEBHOOK_REPLAY_WINDOW_SEC", "300").strip()
    try:
        return max(30, min(int(raw), 3600))
    except ValueError:
        return 300


def _chat_verify_enabled(channel: str) -> bool:
    if channel == "feishu":
        return _bool_env("FEISHU_VERIFY_SIGNATURE", False)
    if channel == "dingtalk":
        return _bool_env("DINGTALK_VERIFY_SIGNATURE", False)
    return False


def _chat_signing_secret(channel: str) -> str:
    if channel == "feishu":
        return os.getenv("FEISHU_SIGNING_SECRET", "").strip()
    if channel == "dingtalk":
        return os.getenv("DINGTALK_SIGNING_SECRET", "").strip()
    return ""


def _chat_verification_token(channel: str) -> str:
    if channel == "feishu":
        return os.getenv("FEISHU_VERIFICATION_TOKEN", "").strip()
    if channel == "dingtalk":
        return os.getenv("DINGTALK_VERIFICATION_TOKEN", "").strip()
    return ""


def _pick_ci_value(source: dict[str, str], *keys: str) -> str:
    if not source:
        return ""
    lower_map = {str(k).lower(): str(v) for k, v in source.items()}
    for key in keys:
        value = lower_map.get(key.lower(), "")
        if value:
            return value.strip()
    return ""


def _extract_webhook_token(payload: dict[str, Any]) -> str:
    candidates = [
        ("token",),
        ("header", "token"),
        ("event", "token"),
    ]
    for path in candidates:
        token = _try_extract_nested(payload, path)
        if token:
            return token
    return ""


def _build_signature_candidates(secret: str, timestamp: str, nonce: str, body_text: str) -> set[str]:
    secret_bytes = secret.encode("utf-8")
    messages = [
        f"{timestamp}\n{nonce}\n{body_text}",
        f"{timestamp}\n{body_text}",
        f"{timestamp}{nonce}{body_text}",
    ]
    output: set[str] = set()
    for msg in messages:
        digest = hmac.new(secret_bytes, msg.encode("utf-8"), hashlib.sha256).digest()
        output.add(base64.b64encode(digest).decode("utf-8").strip().lower())
        output.add(hmac.new(secret_bytes, msg.encode("utf-8"), hashlib.sha256).hexdigest().strip().lower())
    return output


def _is_fresh_timestamp(raw_ts: str, max_skew_sec: int = 600) -> bool:
    try:
        ts = int(raw_ts)
    except (TypeError, ValueError):
        return False
    now = int(time.time())
    return abs(now - ts) <= max_skew_sec


def _extract_replay_id(channel: str, payload: dict[str, Any], timestamp: str, nonce: str, signature: str) -> str:
    event_id = (
        _try_extract_nested(payload, ("header", "event_id"))
        or _try_extract_nested(payload, ("event", "event_id"))
        or _try_extract_nested(payload, ("event", "message", "message_id"))
        or _try_extract_nested(payload, ("msgId",))
        or _try_extract_nested(payload, ("messageId",))
    )
    if event_id:
        return f"{channel}:event:{event_id}"
    if timestamp and signature:
        return f"{channel}:sig:{timestamp}:{nonce}:{signature}"
    return ""


def _public_base_url() -> str:
    return os.getenv("PUBLIC_BASE_URL", "").strip().rstrip("/")


def _oidc_issuer(request: Request | None = None) -> str:
    configured = os.getenv("OIDC_ISSUER", "").strip().rstrip("/")
    if configured:
        return configured
    base_url = _public_base_url()
    if base_url:
        return base_url
    if request is not None:
        return str(request.base_url).rstrip("/")
    return "http://127.0.0.1:8000"


def _sso_success_base(request: Request | None = None) -> str:
    configured = os.getenv("SSO_SUCCESS_URL", "").strip()
    if configured:
        return configured
    base = _public_base_url()
    if base:
        return f"{base}/login"
    if request is not None:
        return f"{str(request.base_url).rstrip('/')}/login"
    return "http://127.0.0.1:8000/login"


def _resolve_safe_post_login_redirect(next_url: str | None, request: Request | None = None) -> str:
    target = str(next_url or "").strip()
    default_target = _sso_success_base(request)
    if not target:
        return default_target

    parsed_default = urllib.parse.urlparse(default_target)
    if target.startswith("/"):
        return urllib.parse.urljoin(default_target, target)

    parsed_target = urllib.parse.urlparse(target)
    if parsed_target.scheme and parsed_target.netloc:
        if parsed_target.scheme == parsed_default.scheme and parsed_target.netloc == parsed_default.netloc:
            return target
        return default_target
    return default_target


def _append_fragment_params(url: str, params: dict[str, Any]) -> str:
    clean_params = {key: str(value) for key, value in params.items() if value is not None and str(value) != ""}
    fragment = urllib.parse.urlencode(clean_params)
    parsed = urllib.parse.urlparse(url)
    return urllib.parse.urlunparse(parsed._replace(fragment=fragment))


def _feishu_callback_url() -> str:
    base_url = _public_base_url()
    if not base_url:
        return ""
    return f"{base_url}/webhook/chat_gateway"


async def _register_webhook_replay(channel: str, replay_id: str) -> bool:
    replay_id = replay_id.strip()
    if not replay_id:
        return True
    window = _webhook_replay_window_sec()
    key = f"chat:webhook:replay:{replay_id}"
    redis: Redis | None = getattr(app.state, "redis", None)
    if redis is not None:
        try:
            accepted = await redis.set(key, "1", ex=window, nx=True)
            return bool(accepted)
        except Exception:  # noqa: BLE001
            pass

    cache: dict[str, float] = getattr(app.state, "webhook_replay_cache", {})
    now = time.time()
    expired_keys = [k for k, expires_at in cache.items() if expires_at <= now]
    for old_key in expired_keys:
        cache.pop(old_key, None)
    if key in cache and cache[key] > now:
        app.state.webhook_replay_cache = cache
        return False
    cache[key] = now + float(window)
    app.state.webhook_replay_cache = cache
    return True


async def _verify_chat_webhook_security(
    *,
    channel: str,
    payload: dict[str, Any],
    headers: dict[str, str],
    query_params: dict[str, str],
    body_text: str,
) -> tuple[bool, str]:
    if channel not in {"feishu", "dingtalk"}:
        return True, ""

    token_expected = _chat_verification_token(channel)
    token_actual = _extract_webhook_token(payload)
    if token_expected and (not token_actual or not secrets.compare_digest(token_actual, token_expected)):
        return False, "invalid_verification_token"

    signing_secret = _chat_signing_secret(channel)
    verify_enabled = _chat_verify_enabled(channel) or bool(signing_secret) or bool(token_expected)
    if not verify_enabled:
        return True, ""

    signature = (
        _pick_ci_value(headers, "x-lark-signature", "x-dingtalk-signature", "x-signature", "signature", "sign")
        or _pick_ci_value(query_params, "sign", "signature")
    )
    timestamp = (
        _pick_ci_value(headers, "x-lark-request-timestamp", "x-dingtalk-timestamp", "x-timestamp", "timestamp")
        or _pick_ci_value(query_params, "timestamp")
    )
    nonce = (
        _pick_ci_value(headers, "x-lark-request-nonce", "x-nonce", "nonce")
        or _pick_ci_value(query_params, "nonce")
    )
    require_timestamp = _chat_verify_enabled(channel) or bool(signing_secret)
    if require_timestamp and (not timestamp or not _is_fresh_timestamp(timestamp)):
        return False, "stale_or_missing_timestamp"

    if signing_secret:
        if not signature:
            return False, "missing_signature"
        expected_candidates = _build_signature_candidates(signing_secret, timestamp, nonce, body_text)
        provided = signature.strip().lower()
        if provided not in expected_candidates:
            return False, "signature_mismatch"

    replay_id = _extract_replay_id(channel, payload, timestamp, nonce, signature)
    if replay_id:
        accepted = await _register_webhook_replay(channel, replay_id)
        if not accepted:
            return False, "replayed_webhook"
    return True, ""


URL_RE = re.compile(r"https?://[^\s]+", re.IGNORECASE)
INKWRITER_MENTION_RE = re.compile(r"@(?:吐墨虾|inkwriter|InkWriter|writer)", re.IGNORECASE)
REPORT_RE = re.compile(r"(战报|大盘)", re.IGNORECASE)
EMPIRE_REPORT_RE = re.compile(r"(帝国日报|经济日报|日报)", re.IGNORECASE)
SIMULATION_CMD_RE = re.compile(r"^(?:仿真|预演|模拟)\s*[:：]?(.*)$", re.IGNORECASE)
VIDEO_GEN_CMD_RE = re.compile(
    r"(?:生成|制作|创建|来一条)\s*([^\s，。,.]{0,16})?\s*(?:推广)?(?:视频|口播|vlog|VLOG)",
    re.IGNORECASE,
)


async def send_chat_reply(
    chat_id: str,
    text: str,
    channel: str = "telegram",
    reply_context: dict[str, Any] | None = None,
    session_id: str | None = None,
) -> None:
    """Unified mobile reply callback: Telegram / Feishu / DingTalk."""
    try:
        print(f"[Chat to {chat_id}][{channel}]: {text}")
    except UnicodeEncodeError:
        safe_text = str(text).encode("gbk", errors="ignore").decode("gbk", errors="ignore")
        print(f"[Chat to {chat_id}][{channel}]: {safe_text}")
    http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
    if http_client is None:
        return

    try:
        if channel == "feishu":
            adapter = getattr(app.state, "feishu_channel", feishu_channel)
            await adapter.reply(chat_id=chat_id, text=text, client=http_client)
            return
        if channel == "dingtalk":
            adapter = getattr(app.state, "dingtalk_channel", dingtalk_channel)
            session_webhook = str((reply_context or {}).get("session_webhook") or "").strip()
            await adapter.reply(
                chat_id=chat_id,
                text=text,
                session_webhook=session_webhook or None,
                client=http_client,
            )
            return

        bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        if not bot_token:
            return
        await http_client.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=15.0,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[Chat reply error] channel={channel} chat_id={chat_id} error={exc}")
    finally:
        if session_id and text.strip():
            try:
                session_mgr.append_message(session_id, role="assistant", content=text)
            except Exception:
                pass


def _queue_chat_reply(
    background_tasks: BackgroundTasks,
    chat_id: str,
    text: str,
    channel: str = "telegram",
    reply_context: dict[str, Any] | None = None,
    session_id: str | None = None,
) -> None:
    # Keep webhook ack fast; do not block on outbound chat API latency.
    background_tasks.add_task(send_chat_reply, chat_id, text, channel, reply_context or {}, session_id)


def _detect_chat_channel(payload: dict[str, Any]) -> str:
    if not isinstance(payload, dict):
        return "telegram"
    header = payload.get("header")
    if isinstance(header, dict) and header.get("event_type"):
        return "feishu"
    if "schema" in payload and "conversationId" in payload:
        return "dingtalk"
    if payload.get("sessionWebhook") or payload.get("conversationId"):
        return "dingtalk"
    return "telegram"


def _extract_reply_context(channel: str, payload: dict[str, Any]) -> dict[str, Any]:
    if channel != "dingtalk":
        return {}
    candidates = [
        ("sessionWebhook",),
        ("event", "sessionWebhook"),
        ("session_webhook",),
        ("event", "session_webhook"),
    ]
    session_webhook = ""
    for path in candidates:
        value = _try_extract_nested(payload, path)
        if value:
            session_webhook = value
            break
    return {"session_webhook": session_webhook} if session_webhook else {}


def _extract_chat_envelope(payload: dict[str, Any]) -> tuple[str, str, str, dict[str, Any]]:
    channel = _detect_chat_channel(payload)
    if channel == "feishu":
        parsed = feishu_channel.parse_event(payload)
        if parsed and parsed.chat_id and parsed.chat_id != "challenge":
            return "feishu", parsed.chat_id, parsed.user_text, {}
    if channel == "dingtalk":
        parsed = dingtalk_channel.parse_event(payload)
        if parsed and parsed.chat_id:
            return "dingtalk", parsed.chat_id, parsed.user_text, _extract_reply_context("dingtalk", payload)

    # Fallback generic extraction (Telegram / custom webhooks).
    return channel, (_extract_chat_id(payload) or "unknown_chat"), _extract_user_text(payload), {}


def _try_extract_nested(source: Any, path: tuple[str, ...]) -> str:
    cursor = source
    for key in path:
        if isinstance(cursor, dict) and key in cursor:
            cursor = cursor[key]
        else:
            return ""
    if cursor is None:
        return ""
    if isinstance(cursor, (str, int, float)):
        return str(cursor).strip()
    return ""


def _extract_chat_id(payload: dict[str, Any]) -> str:
    candidates = [
        ("chat_id",),
        ("chatId",),
        ("message", "chat_id"),
        ("message", "chat", "id"),
        ("event", "chat_id"),
        ("event", "message", "chat_id"),
        ("header", "chat_id"),
        ("sender", "sender_id", "open_id"),
        ("sender", "id"),
    ]
    for path in candidates:
        value = _try_extract_nested(payload, path)
        if value:
            return value
    return ""


def _extract_peer_id(payload: dict[str, Any], *, fallback: str = "") -> str:
    candidates = [
        ("peer_id",),
        ("peerId",),
        ("sender_id",),
        ("senderId",),
        ("sender", "sender_id", "open_id"),
        ("sender", "sender_id", "user_id"),
        ("sender", "open_id"),
        ("sender", "id"),
        ("event", "sender", "sender_id", "open_id"),
        ("event", "sender", "sender_id", "user_id"),
        ("event", "sender", "id"),
        ("event", "open_id"),
        ("from", "id"),
    ]
    for path in candidates:
        value = _try_extract_nested(payload, path)
        if value:
            return value
    return str(fallback or "").strip()


def _resolve_chat_session_mode(channel: str, *, tenant_id: str = "", account_id: str = "") -> str:
    account = channel_account_manager.route_message(channel, tenant_id=tenant_id, account_id=account_id)
    if account is not None:
        dm_scope = str(account.options.get("dm_scope") or "").strip().lower()
        if dm_scope in {"shared", "isolated", "per-peer", "per_peer", "peer"}:
            return "per-peer" if dm_scope in {"per_peer", "peer"} else dm_scope
    return "per-peer"


def _extract_user_text(payload: dict[str, Any]) -> str:
    candidates = [
        ("user_text",),
        ("text",),
        ("message", "text"),
        ("event", "text"),
        ("event", "message", "text"),
        ("content", "text"),
        ("event", "message", "content", "text"),
    ]
    for path in candidates:
        value = _try_extract_nested(payload, path)
        if value:
            return value

    content_raw = _try_extract_nested(payload, ("event", "message", "content"))
    if content_raw:
        try:
            parsed = json.loads(content_raw)
            if isinstance(parsed, dict):
                text = str(parsed.get("text", "")).strip()
                if text:
                    return text
        except json.JSONDecodeError:
            pass
    return ""


def _extract_first_url(text: str) -> str:
    match = URL_RE.search(text)
    if not match:
        return ""
    return match.group(0).rstrip(").,;!?'\"")


def _extract_inkwriter_task(text: str) -> str:
    cleaned = INKWRITER_MENTION_RE.sub("", text).strip()
    cleaned = re.sub(r"^[：:,\-\s]+", "", cleaned).strip()
    return cleaned


def _extract_simulation_task(text: str) -> str:
    matched = SIMULATION_CMD_RE.search(text.strip())
    if not matched:
        return ""
    return str(matched.group(1) or "").strip()


def _extract_video_generation_intent(text: str) -> dict[str, Any] | None:
    raw = str(text or "").strip()
    if not raw:
        return None
    lower_text = raw.lower()
    if "生成" not in raw and "制作" not in raw and "创建" not in raw and "来一条" not in raw:
        return None
    if all(token not in lower_text for token in ["视频", "口播", "vlog"]):
        return None

    match = VIDEO_GEN_CMD_RE.search(raw)
    industry_hint = str(match.group(1) or "").strip() if match else ""
    task_text = raw
    if "推广视频" not in task_text and "口播" not in task_text and "vlog" not in lower_text:
        task_text = f"{raw}（行业推广视频）"
    industry = detect_video_industry(task_text, [industry_hint] if industry_hint else [])
    if industry == "general" and industry_hint:
        # Preserve explicit hint when keyword dictionary misses it.
        industry = re.sub(r"[^a-zA-Z0-9_\u4e00-\u9fff]+", "", industry_hint.lower())[:32] or "general"
    return {
        "industry": industry,
        "industry_hint": industry_hint,
        "task_text": task_text,
        "digital_human_mode": any(token in raw for token in ["口播", "数字人", "主播"]),
        "vlog_narration_mode": ("vlog" in lower_text) or any(token in raw for token in ["旁白", "第一视角", "探店"]),
    }


def _render_static_report() -> str:
    rag = rag_status()
    rag_count = int(rag.get("fallback_memory_size", 0) or 0)
    return (
        "## 龙虾元老院战报\n"
        f"- 存活边缘节点: 7/9 (模拟)\n"
        f"- RAG兵法库条目: {rag_count}\n"
        "- 今日拦截高意向线索: 26\n"
        "- DLQ重放成功率: 98.2%\n"
        "- 当前执行态势: 稳定推进"
    )


def _edge_registry_map() -> dict[str, dict[str, Any]]:
    """Safely access edge registry even when lifespan was not entered."""
    registry = getattr(app.state, "edge_registry", None)
    if isinstance(registry, dict):
        return registry
    app.state.edge_registry = {}
    return app.state.edge_registry


def _edge_outbox_map() -> dict[str, list[dict[str, Any]]]:
    outbox = getattr(app.state, "edge_outbox", None)
    if isinstance(outbox, dict):
        return outbox
    app.state.edge_outbox = {}
    return app.state.edge_outbox


def _edge_outbox_manager() -> EdgeOutbox | None:
    manager = getattr(app.state, "edge_outbox_manager", None)
    if isinstance(manager, EdgeOutbox):
        return manager
    return None


def _edge_outbox_runtime_view() -> dict[str, list[dict[str, Any]]]:
    manager = _edge_outbox_manager()
    if manager is not None:
        try:
            return manager.queue_view()
        except Exception:
            pass
    return _edge_outbox_map()


def _edge_outbox_pending_counts() -> dict[str, int]:
    manager = _edge_outbox_manager()
    if manager is not None:
        try:
            return manager.pending_counts_by_node()
        except Exception:
            pass
    return {
        edge_id: len(queue)
        for edge_id, queue in _edge_outbox_map().items()
        if queue
    }


def _render_dynamic_empire_report(*, user_id: str) -> str:
    rag = rag_status()
    rag_count = int(rag.get("fallback_memory_size", 0) or 0)
    economy = clawwork_daily_report(user_id=user_id, days=1)
    summary = economy.get("summary", {})
    wallet = clawwork_status(user_id).get("wallet", {})
    events = lossless_query_events(user_id=user_id, limit=300)
    lead_events = sum(1 for e in events if str(e.get("event_type", "")).lower() == "lead_scored")
    edge_registry = _edge_registry_map()
    edge_outbox_counts = _edge_outbox_pending_counts()
    edge_rows = [row for row in edge_registry.values() if row.get("user_id") == user_id]
    edge_online = len(edge_rows)
    outbox_pending = sum(
        int(edge_outbox_counts.get(str(row.get("edge_id")), 0) or 0)
        for row in edge_rows
    )
    return (
        "## 龙虾帝国日报\n"
        f"- 用户: `{user_id}`\n"
        f"- 存活边缘节点: {edge_online}\n"
        f"- 待下发任务包: {outbox_pending}\n"
        f"- RAG兵法库条目: {rag_count}\n"
        f"- 今日线索捕获: {lead_events}\n"
        f"- 今日执行成功率: {summary.get('success_rate', 0)}\n"
        f"- 今日收入(CNY): {summary.get('earned_cny', 0)}\n"
        f"- 今日支出(CNY): {summary.get('spent_cny', 0)}\n"
        f"- 当前钱包余额(CNY): {wallet.get('balance_cny', 0)}"
    )


def _chat_session_history_messages(session_id: str | None, limit: int = 20) -> list[dict[str, Any]]:
    if not session_id:
        return []
    return [
        {"role": str(item.get("role") or "user"), "content": str(item.get("content") or "")}
        for item in session_mgr.get_history(session_id, limit)
        if str(item.get("content") or "").strip()
    ]


def _research_sources_default() -> list[str]:
    return ["openalex", "github_projects", "huggingface_papers", "qbitai"]


def _research_fetch_by_source(source: str) -> list[dict[str, Any]]:
    source_key = str(source or "").strip().lower()
    if source_key == "openalex":
        return fetch_openalex_hot(100) + fetch_openalex_latest(100)
    if source_key == "github_projects":
        return fetch_github_hot(100) + fetch_github_latest(100)
    if source_key == "huggingface_papers":
        return fetch_huggingface_hot(50)
    if source_key == "qbitai":
        return fetch_qbitai_latest(100)
    raise ValueError(f"unsupported source: {source}")


def _research_retry_limit() -> int:
    raw = str(os.getenv("RESEARCH_RADAR_FETCH_RETRIES", "2")).strip()
    try:
        return max(1, min(int(raw), 5))
    except ValueError:
        return 2


def _research_fetch_with_retry(source: str) -> dict[str, Any]:
    retry_limit = _research_retry_limit()
    total_duration_ms = 0
    last_error = ""
    for attempt in range(1, retry_limit + 1):
        started = time.perf_counter()
        try:
            rows = _research_fetch_by_source(source)
            total_duration_ms += int((time.perf_counter() - started) * 1000)
            return {
                "ok": True,
                "rows": rows,
                "attempts": attempt,
                "duration_ms": total_duration_ms,
                "error": "",
            }
        except Exception as exc:  # noqa: BLE001
            total_duration_ms += int((time.perf_counter() - started) * 1000)
            last_error = str(exc)[:400]
            if attempt >= retry_limit:
                break
            time.sleep(min(1.5 * attempt, 3.0))
    return {
        "ok": False,
        "rows": [],
        "attempts": retry_limit,
        "duration_ms": total_duration_ms,
        "error": last_error or "fetch_failed",
    }


def _research_upsert_auto_row(*, tenant_id: str, item: dict[str, Any]) -> dict[str, Any]:
    title = str(item.get("title") or "").strip()
    url = str(item.get("url") or "").strip()
    summary = str(item.get("summary") or "").strip()
    if not title or not url:
        raise ValueError("missing title or url")
    tags = research_extract_tags(title, summary)
    actionability = research_actionability_score(title=title, summary=summary, tags=tags)
    hot_score = research_normalize_hot_score(item.get("hot_score_raw", 0))
    score, credibility = research_combined_score(
        source=str(item.get("source") or "manual"),
        hot_score=hot_score,
        actionability=actionability,
        freshness=float(item.get("freshness") or 0.5),
    )
    return research_upsert_signal(
        tenant_id=tenant_id,
        source=str(item.get("source") or "unknown"),
        bucket=str(item.get("bucket") or "A_auto"),
        rank_type=str(item.get("rank_type") or "latest"),
        title=title,
        url=url,
        summary=summary,
        tags=tags,
        score=score,
        credibility=credibility,
        actionability=actionability,
        raw=item.get("raw") if isinstance(item.get("raw"), dict) else item,
        published_at=str(item.get("published_at") or ""),
    )


def _research_upsert_manual_row(*, tenant_id: str, item: ResearchSignalManualInput) -> dict[str, Any]:
    title = str(item.title or "").strip()
    url = str(item.url or "").strip()
    summary = str(item.summary or "").strip()
    tags = item.tags if item.tags else research_extract_tags(title, summary)
    actionability = (
        float(item.actionability)
        if item.actionability is not None
        else research_actionability_score(title=title, summary=summary, tags=tags)
    )
    credibility = float(item.credibility) if item.credibility is not None else 0.65
    score = float(item.score) if item.score is not None else max(0.0, min(1.0, (credibility * 0.45) + (actionability * 0.55)))
    return research_upsert_signal(
        tenant_id=tenant_id,
        source=str(item.source or "manual"),
        bucket="C_manual",
        rank_type=str(item.rank_type or "manual"),
        title=title,
        url=url,
        summary=summary,
        tags=tags,
        score=score,
        credibility=credibility,
        actionability=actionability,
        raw=item.raw or {},
        published_at=item.published_at or "",
    )


def _render_research_digest_markdown(items: list[dict[str, Any]], tenant_id: str) -> str:
    lines = [
        "## 龙虾情报晨报",
        f"- 租户: `{tenant_id}`",
        f"- 条目数: {len(items)}",
        "",
    ]
    for idx, item in enumerate(items, start=1):
        tags = ", ".join(item.get("tags", [])[:6])
        lines.extend(
            [
                f"{idx}. **{item.get('title', '')}**",
                f"   - source: `{item.get('source', '')}` / rank: `{item.get('rank_type', '')}`",
                f"   - score: `{item.get('score', 0)}` / actionability: `{item.get('actionability', 0)}`",
                f"   - tags: {tags or '-'}",
                f"   - url: {item.get('url', '')}",
                "",
            ]
        )
    lines.append("建议：优先执行前 5 条（高 actionability），其余进入观察池。")
    return "\n".join(lines)


def _normalize_skills(raw: list[str] | str | None) -> list[str]:
    values: list[str]
    if raw is None:
        values = []
    elif isinstance(raw, str):
        values = [part.strip() for part in raw.split(",")]
    else:
        values = [str(item).strip() for item in raw]
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        skill = value.strip().lower()
        if not skill or skill in seen:
            continue
        seen.add(skill)
        output.append(skill)
    return output


def _normalize_commands(raw: list[str] | str | None) -> list[str]:
    values: list[str]
    if raw is None:
        values = []
    elif isinstance(raw, str):
        values = [part.strip() for part in raw.split(",")]
    else:
        values = [str(item).strip() for item in raw]
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        cmd = re.sub(r"\s+", " ", value).strip()
        if not cmd or cmd in seen:
            continue
        seen.add(cmd)
        output.append(cmd)
    return output[:50]


def _resolve_industry_tag_for_task(
    *,
    task_description: str,
    competitor_handles: list[str],
    industry_tag_hint: str | None,
) -> str:
    if industry_tag_hint and str(industry_tag_hint).strip():
        resolved = taxonomy_resolve_subindustry_tag(industry_tag_hint, fallback=industry_tag_hint)
        return industry_kb_normalize_tag(resolved)
    detected = detect_video_industry(task_description, competitor_handles)
    mapped = taxonomy_coarse_to_subindustry_tag(detected)
    return industry_kb_normalize_tag(mapped)


def _ensure_industry_profile_seed(
    *,
    tenant_id: str,
    industry_tag: str,
    actor_user_id: str | None = None,
) -> dict[str, Any]:
    seed = taxonomy_profile_seed_from_tag(industry_tag)
    saved = industry_kb_upsert_profile(
        tenant_id=tenant_id,
        industry_tag=str(seed.get("industry_tag", industry_tag)),
        display_name=str(seed.get("display_name", "")) or None,
        description=str(seed.get("description", "")) or None,
        status="active",
        config=dict(seed.get("config", {}) or {}),
    )
    _remember_event(
        user_id=str(actor_user_id or "system"),
        trace_id=None,
        node="industry_kb.profile.seed",
        event_type="upsert",
        payload={
            "tenant_id": tenant_id,
            "industry_tag": saved.get("industry_tag"),
            "display_name": saved.get("display_name"),
        },
        level="info",
    )
    return saved


def _load_industry_kb_context(
    *,
    tenant_id: str,
    industry_tag: str,
    task_description: str,
    limit: int,
) -> dict[str, Any]:
    safe_limit = max(1, min(int(limit or 6), 20))
    context = industry_kb_build_runtime_context(
        tenant_id=tenant_id,
        industry_tag=industry_tag,
        query=task_description,
        limit=safe_limit,
    )
    return {
        "industry_tag": industry_tag,
        "knowledge_scope": context.get("knowledge_scope"),
        "count": int(context.get("count", 0) or 0),
        "references": context.get("references", []),
    }


def _normalize_competitor_accounts(values: list[str]) -> list[str]:
    dedup: list[str] = []
    seen: set[str] = set()
    for raw in values:
        account = str(raw or "").strip()
        if not account:
            continue
        key = account.lower()
        if key in seen:
            continue
        seen.add(key)
        dedup.append(account)
    return dedup[:20]


def _to_startup_playbook(formula: dict[str, Any], *, industry_tag: str) -> dict[str, Any]:
    account = str(formula.get("source_account") or "benchmark_account")
    hook = str(formula.get("hook_type") or "pain hook")
    structure = str(formula.get("content_structure") or "hook->proof->cta")
    storyboard_count = int(formula.get("storyboard_count", 7) or 7)
    cta = str(formula.get("cta") or "DM for details")
    topic = str(formula.get("topic_focus") or "conversion")
    content = (
        f"Positioning: {industry_tag} practical account for conversion.\n"
        f"First-3-post launch plan:\n"
        f"1) Post 1: {hook} around {topic}\n"
        f"2) Post 2: showcase structure {structure}\n"
        f"3) Post 3: FAQ + objection handling + CTA ({cta})\n"
        f"Storyboard baseline: {storyboard_count} scenes.\n"
        f"Engagement rhythm: pin one CTA comment and run DM follow-up."
    )
    return {
        "entry_type": "startup_playbook",
        "title": f"{industry_tag} launch playbook from {account}",
        "content": content,
        "source_url": str(formula.get("source_url") or ""),
        "source_account": account,
        "effect_score": float(formula.get("effect_score", 0) or 0),
        "metadata": {
            "topic_focus": topic,
            "hook_type": hook,
            "content_structure": structure,
            "storyboard_count": storyboard_count,
            "cta": cta,
        },
    }


def _to_copy_template(formula: dict[str, Any], *, industry_tag: str) -> dict[str, Any]:
    hook = str(formula.get("hook_type") or "pain hook")
    cta = str(formula.get("cta") or "DM for quote")
    slang = str(formula.get("persona_slang") or "")
    topic = str(formula.get("topic_focus") or "conversion")
    storyboard_count = int(formula.get("storyboard_count", 7) or 7)
    content = (
        f"Title template: [{industry_tag}] {topic} | {hook}\n"
        f"Opening template: 3-second hook around '{hook}', then proof and scenario.\n"
        f"Comment guide template: ask one problem-focused question and close with CTA.\n"
        f"CTA template: {cta}\n"
        f"Persona slang: {slang}\n"
        f"Storyboard recommendation: {storyboard_count} scenes."
    )
    return {
        "entry_type": "copy_template",
        "title": f"{industry_tag} copy template {hook}",
        "content": content,
        "source_url": str(formula.get("source_url") or ""),
        "source_account": str(formula.get("source_account") or ""),
        "effect_score": float(formula.get("effect_score", 0) or 0),
        "metadata": {
            "topic_focus": topic,
            "hook_type": hook,
            "cta": cta,
            "persona_slang": slang,
            "storyboard_count": storyboard_count,
        },
    }


def _build_industry_dissect_report_markdown(
    *,
    industry_tag: str,
    trace_id: str,
    competitor_accounts: list[str],
    formulas_count: int,
    startup_playbooks_count: int,
    copy_templates_count: int,
    kb_ingested_count: int,
    kb_rejected_count: int,
    kb_duplicate_count: int,
) -> str:
    lines = [
        "## 龙虾行业建库报告",
        f"- 行业标签: `{industry_tag}`",
        f"- trace_id: `{trace_id}`",
        f"- 对标账号数: `{len(competitor_accounts)}`",
        "",
        "### 拆解与提取结果",
        f"- 爆款公式: `{formulas_count}`",
        f"- 起号方案: `{startup_playbooks_count}`",
        f"- 文案模板: `{copy_templates_count}`",
        "",
        "### 入库结果",
        f"- 成功入库: `{kb_ingested_count}`",
        f"- 低质量拒绝: `{kb_rejected_count}`",
        f"- 重复去重: `{kb_duplicate_count}`",
        "",
        "✅ 已存入知识池（可用于后续策略与创作调用）",
    ]
    return "\n".join(lines)


def _delivery_readiness_snapshot(user_id: str | None = None) -> dict[str, Any]:
    rag = rag_status(user_id=user_id)
    rag_multimodal = raganything_status(user_id=user_id)
    edge_registry = getattr(app.state, "edge_registry", {})
    edge_outbox = _edge_outbox_runtime_view()
    scoped_edges = [
        row for row in edge_registry.values() if not user_id or str(row.get("user_id")) == user_id
    ]
    pending_packages = {
        edge_id: len(queue)
        for edge_id, queue in edge_outbox.items()
        if queue and (not user_id or str(edge_registry.get(edge_id, {}).get("user_id")) == user_id)
    }
    known_skill_edges = len([row for row in scoped_edges if row.get("skills")])
    known_command_edges = len([row for row in scoped_edges if row.get("skill_commands")])
    known_skills = sorted(
        {
            str(skill).strip().lower()
            for row in scoped_edges
            for skill in (row.get("skills") or [])
            if str(skill).strip()
        }
    )
    known_commands = sorted(
        {
            re.sub(r"\s+", " ", str(command)).strip()
            for row in scoped_edges
            for command in (row.get("skill_commands") or [])
            if str(command).strip()
        }
    )
    return {
        "checkpointer_mode": getattr(app.state, "checkpointer_mode", "unknown"),
        "main_graph_ready": hasattr(app.state, "main_graph"),
        "dm_graph_ready": hasattr(app.state, "dm_graph"),
        "registered_edges": len(scoped_edges),
        "registered_edges_with_skills": known_skill_edges,
        "registered_edges_with_commands": known_command_edges,
        "known_edge_skills": known_skills[:50],
        "known_edge_commands": known_commands[:50],
        "pending_outbox": pending_packages,
        "rag": {
            "collection_name": rag.get("collection_name"),
            "qdrant_enabled": rag.get("qdrant_enabled"),
            "binary_quantization_enabled": rag.get("binary_quantization_enabled"),
            "binary_quantization_error": rag.get("binary_quantization_error"),
            "fallback_memory_size": rag.get("fallback_memory_size"),
            "multimodal": rag_multimodal,
        },
        "anythingllm": {
            "base_url": os.getenv("ANYTHINGLLM_BASE_URL", "http://127.0.0.1:3002"),
            "embed_enabled": bool(os.getenv("ANYTHINGLLM_EMBED_SCRIPT_URL", "").strip()),
        },
        "integrations": {
            "raganything_mode": rag_multimodal.get("mode"),
            "raganything_strict_mode": rag_multimodal.get("strict_mode"),
            "cli_anything_ready_edges": known_command_edges,
            "anythingllm_base_url": os.getenv("ANYTHINGLLM_BASE_URL", "http://127.0.0.1:3002"),
            "clawteam_db_path": os.getenv("CLAWTEAM_DB_PATH", "./data/clawteam_inbox.sqlite"),
            "policy_bandit_enabled": os.getenv("POLICY_BANDIT_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"},
        },
        "billing": {
            "guard_enabled": _billing_guard_enabled(),
            "guarded_paths": sorted(_billing_guarded_paths()),
        },
    }


def _commercial_readiness_snapshot() -> dict[str, Any]:
    icp_profile = Path(__file__).resolve().parents[1] / "deploy" / "compliance" / "icp_launch_profile.template.json"
    icp_pack = Path(__file__).resolve().parents[1] / "tmp" / "icp_materials" / "manifest.json"
    payment = {
        "provider_health": payment_gateway.provider_health(),
        "sandbox_checkout_enabled": os.getenv("PAYMENT_ALLOW_SANDBOX_CHECKOUT", "true").strip().lower() in {"1", "true", "yes", "on"},
        "webhook_secret_configured": bool(os.getenv("PAYMENT_WEBHOOK_HMAC_SECRET", "").strip()),
    }
    notifications = auth_notification_status()
    feishu = {
        "callback_url": _feishu_callback_url(),
        "enabled": _bool_env("FEISHU_ENABLED", False),
        "verify_signature": _chat_verify_enabled("feishu"),
        "verification_token_configured": bool(_chat_verification_token("feishu")),
        "signing_secret_configured": bool(_chat_signing_secret("feishu")),
    }

    unresolved_icp_fields = 0
    if icp_profile.exists():
        try:
            profile_payload = json.loads(icp_profile.read_text(encoding="utf-8"))

            def walk(node: Any) -> None:
                nonlocal unresolved_icp_fields
                if isinstance(node, dict):
                    for value in node.values():
                        walk(value)
                elif isinstance(node, list):
                    for value in node:
                        walk(value)
                elif isinstance(node, str) and node.startswith("REPLACE_WITH_"):
                    unresolved_icp_fields += 1

            walk(profile_payload)
        except Exception:  # noqa: BLE001
            unresolved_icp_fields = -1

    deploy = {
        "public_base_url": _public_base_url(),
        "region_priority": os.getenv("REGION_PRIORITY", "cn-shanghai").strip() or "cn-shanghai",
        "data_residency": os.getenv("DATA_RESIDENCY_MODE", "mainland-china-first").strip() or "mainland-china-first",
    }
    compliance = {
        "icp_profile_template_exists": icp_profile.exists(),
        "icp_material_pack_exists": icp_pack.exists(),
        "privacy_policy_page": True,
        "terms_page": True,
        "icp_ready_page": True,
        "unresolved_icp_fields": unresolved_icp_fields,
    }

    blockers: list[dict[str, Any]] = []
    if not payment["webhook_secret_configured"]:
        blockers.append({
            "id": "payment_webhook_secret",
            "severity": "high",
            "domain": "payment",
            "title": "Payment webhook secret missing",
            "detail": "Webhook signature validation cannot be enforced until the production secret is configured.",
            "next_action": "Set PAYMENT_WEBHOOK_HMAC_SECRET and production provider credentials.",
        })
    provider_ready = payment["provider_health"]["providers"]
    if not any(bool(row.get("ready")) for row in provider_ready.values()):
        blockers.append({
            "id": "payment_provider_credentials",
            "severity": "high",
            "domain": "payment",
            "title": "No production payment provider is ready",
            "detail": "Sandbox checkout works, but no production merchant credentials are configured.",
            "next_action": "Inject Stripe/Alipay/WeChat Pay production credentials.",
        })
    if not notifications.get("smtp", {}).get("configured") and not notifications.get("sms_webhook_configured"):
        blockers.append({
            "id": "notification_provider",
            "severity": "high",
            "domain": "notifications",
            "title": "No production notification provider is configured",
            "detail": "Password reset and onboarding alerts are still using file or mock delivery.",
            "next_action": "Configure SMTP or SMS provider credentials.",
        })
    if not feishu["callback_url"] or not feishu["enabled"] or not (feishu["verification_token_configured"] or feishu["signing_secret_configured"]):
        blockers.append({
            "id": "feishu_public_callback",
            "severity": "medium",
            "domain": "feishu",
            "title": "Feishu public callback is not ready",
            "detail": "The code path exists, but callback URL or verification secrets are incomplete.",
            "next_action": "Set PUBLIC_BASE_URL and FEISHU_* callback secrets, then run preflight_feishu_callback.py.",
        })
    if unresolved_icp_fields != 0:
        blockers.append({
            "id": "icp_offline_materials",
            "severity": "high",
            "domain": "compliance",
            "title": "ICP offline filing profile still has placeholders",
            "detail": f"Current unresolved placeholder fields: {unresolved_icp_fields}.",
            "next_action": "Replace REPLACE_WITH_* fields using real legal entity, domain, and operator info.",
        })

    score = 100
    for blocker in blockers:
        score -= 20 if blocker["severity"] == "high" else 10
    score = max(0, score)

    return {
        "score": score,
        "status": "launch_ready" if score >= 90 and len(blockers) == 0 else ("near_ready" if score >= 60 else "blocked"),
        "blocker_count": len(blockers),
        "blockers": blockers,
        "deploy": deploy,
        "payment": payment,
        "notifications": notifications,
        "feishu": feishu,
        "compliance": compliance,
    }


def _graph_config(thread_id: str, *, run_type: str, user_id: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    metadata = {
        "service": "dragon-senate-saas-v2",
        "run_type": run_type,
        "user_id": user_id,
        "thread_id": thread_id,
    }
    if extra:
        metadata.update(extra)
    return {
        "configurable": {"thread_id": thread_id},
        "tags": ["dragon-senate-v3", run_type],
        "metadata": metadata,
    }


async def _invoke_dynamic_graph(
    goal: str,
    payload: dict[str, Any],
    config: dict[str, Any],
    *,
    industry_context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    动态路由入口：根据 goal 让 commander 决定调用哪几只虾，组装对应图后执行。

    替代所有直接调用 app.state.main_graph.ainvoke(payload, config) 的地方。
    兜底：若动态图组装失败，自动降级到静态 main_graph。
    """
    checkpointer = getattr(getattr(app, "state", None), "checkpointer", None)
    ctx: dict[str, Any] = dict(industry_context or {})
    if "tenant_id" not in ctx:
        ctx["tenant_id"] = str(payload.get("tenant_id") or payload.get("user_id") or "tenant_main")
    if "user_id" not in ctx:
        ctx["user_id"] = str(payload.get("user_id") or "")
    try:
        return await _dragon_ainvoke_for_goal(
            goal=goal,
            state_input=payload,
            industry_context=ctx,
            config=config,
            checkpointer=checkpointer,
        )
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).warning(
            "_invoke_dynamic_graph failed, falling back to static main_graph: %s", exc
        )
        return await app.state.main_graph.ainvoke(payload, config)


def _get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _audit_cleanup_interval_sec() -> int:
    raw = os.getenv("AUDIT_CLEANUP_INTERVAL_SEC", "86400").strip()
    try:
        return max(3600, int(raw))
    except ValueError:
        return 86400


async def _audit_cleanup_loop() -> None:
    while True:
        await asyncio.sleep(_audit_cleanup_interval_sec())
        try:
            audit = get_audit_service()
            tenant_ids = audit.list_tenant_ids() or ["tenant_main"]
            for tenant_id in tenant_ids:
                result = audit.cleanup_expired(tenant_id)
                logger.info("[audit_cleanup] %s %s", tenant_id, result)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[audit_cleanup] failed: %s", exc)


def _flag_env(value: str | None) -> FeatureFlagEnvironment:
    try:
        return FeatureFlagEnvironment(str(value or "prod"))
    except Exception:
        return FeatureFlagEnvironment.PROD


def _to_flag(body: FeatureFlagCreateRequest | FeatureFlagUpdateRequest, *, name: str, created_by: str, existing: FeatureFlag | None = None) -> FeatureFlag:
    environment = _flag_env(getattr(body, "environment", None) or (existing.environment.value if existing else "prod"))
    strategies_raw = getattr(body, "strategies", None)
    variants_raw = getattr(body, "variants", None)
    strategies = (
        [FlagStrategy(type=StrategyType(item.type), parameters=dict(item.parameters or {})) for item in strategies_raw]
        if strategies_raw is not None and len(strategies_raw) > 0
        else (existing.strategies if existing else [FlagStrategy(type=StrategyType.ALL)])
    )
    variants = (
        [FlagVariant(name=item.name, weight=item.weight, payload=item.payload, enabled=item.enabled) for item in variants_raw]
        if variants_raw is not None
        else (existing.variants if existing else [])
    )
    return FeatureFlag(
        name=name,
        enabled=getattr(body, "enabled", None) if getattr(body, "enabled", None) is not None else (existing.enabled if existing else True),
        environment=environment,
        strategies=strategies,
        variants=variants,
        description=getattr(body, "description", None) if getattr(body, "description", None) is not None else (existing.description if existing else ""),
        tags=getattr(body, "tags", None) if getattr(body, "tags", None) is not None else (existing.tags if existing else []),
        tenant_id=getattr(body, "tenant_id", None) if getattr(body, "tenant_id", None) is not None else (existing.tenant_id if existing else None),
        created_by=created_by,
        created_at=existing.created_at if existing else _utc_now(),
        updated_at=_utc_now(),
        is_builtin=existing.is_builtin if existing else False,
    )


def _flag_check_ctx(body: FeatureFlagCheckRequest) -> FeatureFlagContext:
    return FeatureFlagContext(
        tenant_id=body.tenant_id,
        user_id=body.user_id,
        lobster_id=body.lobster_id,
        edge_node_id=body.edge_node_id,
        edge_node_tags=[str(item).strip() for item in body.edge_node_tags if str(item).strip()],
        environment=_flag_env(body.environment),
    )


def _edge_flag_applicable(flag: FeatureFlag, node_tags: list[str]) -> bool:
    if not flag.enabled:
        return False
    edge_tag_strategies = [item for item in flag.strategies if item.type == StrategyType.EDGE_NODE_TAG]
    if not edge_tag_strategies:
        return True
    node_tag_set = {str(item).strip() for item in node_tags if str(item).strip()}
    for strategy in edge_tag_strategies:
        required = {str(item).strip() for item in strategy.parameters.get("tags", []) if str(item).strip()}
        if required & node_tag_set:
            return True
    return False


async def _broadcast_feature_flag_event(event_type: str, flag: FeatureFlag | None) -> None:
    subscribers: set[WebSocket] = getattr(app.state, "feature_flag_ws_clients", set())
    if not subscribers:
        return
    payload = {
        "type": event_type,
        "flag": flag.to_dict() if flag is not None else None,
        "name": flag.name if flag is not None else "",
    }
    stale: list[WebSocket] = []
    for ws in list(subscribers):
        try:
            await ws.send_text(json.dumps(payload, ensure_ascii=False))
        except Exception:
            stale.append(ws)
    for ws in stale:
        subscribers.discard(ws)


def _jwt_secret() -> str:
    return _get_required_env("JWT_SECRET")


def _edge_secret() -> str:
    return _get_required_env("EDGE_SHARED_SECRET")


def _hitl_secret() -> str:
    return os.getenv("HITL_SHARED_SECRET", "").strip() or _edge_secret()


def _redis_url() -> str:
    return os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0").strip()


def _configure_langsmith() -> dict[str, Any]:
    api_key = os.getenv("LANGSMITH_API_KEY", "").strip()
    project = os.getenv("LANGSMITH_PROJECT", "dragon-senate-v3").strip()
    endpoint = os.getenv("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com").strip()

    if not api_key:
        return {"enabled": False, "project": project}

    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_API_KEY"] = api_key
    os.environ["LANGCHAIN_PROJECT"] = project
    os.environ["LANGCHAIN_ENDPOINT"] = endpoint
    return {"enabled": True, "project": project, "endpoint": endpoint}


def _jwt_ttl_minutes() -> int:
    raw = os.getenv("JWT_EXPIRE_MINUTES", "120").strip()
    try:
        return max(5, int(raw))
    except ValueError:
        return 120


def _load_users() -> list[dict[str, Any]]:
    raw = os.getenv("APP_USERS_JSON", "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                users = [u for u in parsed if isinstance(u, dict)]
                if users:
                    return users
        except json.JSONDecodeError:
            pass
    return [
        {
            "username": "admin",
            "password": "change_me",
            "tenant_id": "tenant_main",
            "roles": ["admin"],
        }
    ]


def _oidc_default_audience(client_id: str | None = None) -> str:
    configured = os.getenv("OIDC_AUDIENCE", "").strip()
    if configured:
        return configured
    raw_client = str(client_id or "").strip()
    return raw_client or "dragon-senate"


def _scim_bearer_token() -> str:
    return os.getenv("SCIM_BEARER_TOKEN", "").strip()


def _scim_default_tenant() -> str:
    return os.getenv("SCIM_DEFAULT_TENANT", "").strip() or "tenant_main"


async def _read_request_payload(request: Request) -> dict[str, Any]:
    content_type = str(request.headers.get("content-type") or "").lower()
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        try:
            form = await request.form()
            payload: dict[str, Any] = {}
            for key, value in form.items():
                if isinstance(value, UploadFile):
                    payload[str(key)] = value.filename
                else:
                    payload[str(key)] = value
            return payload
        except Exception:
            pass

    try:
        payload = await request.json()
        if isinstance(payload, dict):
            return payload
    except Exception:
        pass

    try:
        raw_body = (await request.body()).decode("utf-8").strip()
    except Exception:
        raw_body = ""
    if not raw_body:
        return {}
    parsed = urllib.parse.parse_qs(raw_body, keep_blank_values=True)
    payload = {}
    for key, values in parsed.items():
        if not values:
            payload[str(key)] = ""
        elif len(values) == 1:
            payload[str(key)] = values[0]
        else:
            payload[str(key)] = values
    return payload


async def _enforce_login_mfa(
    tenant_id: str,
    user_id: str,
    otp_code: str | None,
    *,
    source: str,
) -> None:
    from auth_mfa import get_mfa_store

    mfa_store = get_mfa_store()
    if not mfa_store.is_enabled(tenant_id, user_id):
        return
    if not otp_code:
        raise HTTPException(status_code=401, detail="mfa_required")
    verified = mfa_store.verify_code(tenant_id, user_id, otp_code, allow_pending=False)
    if not verified:
        await get_audit_service().log(
            event_type=AuditEventType.AUTH_MFA_VERIFY_FAILED,
            tenant_id=tenant_id,
            user_id=user_id,
            resource_type="auth_mfa",
            resource_id=user_id,
            details={"source": source},
        )
        raise HTTPException(status_code=401, detail="invalid_mfa_code")
    mfa_store.mark_verified(tenant_id, user_id)
    await get_audit_service().log(
        event_type=AuditEventType.AUTH_MFA_VERIFY,
        tenant_id=tenant_id,
        user_id=user_id,
        resource_type="auth_mfa",
        resource_id=user_id,
        details={"source": source},
    )


async def _authenticate_login_identity(
    username: str,
    password: str,
    otp_code: str | None = None,
    *,
    source: str,
) -> tuple[str, str, list[str], bool, Any | None]:
    auth_user = await authenticate_identity_password(username, password)
    if auth_user is not None:
        claims = claims_from_user(auth_user)
        await _enforce_login_mfa(
            claims.tenant_id,
            claims.sub,
            otp_code,
            source=source,
        )
        return claims.sub, claims.tenant_id, claims.roles, False, auth_user

    users = _load_users()
    for user in users:
        if user.get("username") != username:
            continue
        if not secrets.compare_digest(str(user.get("password", "")), password):
            break
        tenant_id = str(user.get("tenant_id", "tenant_main"))
        roles = [str(role).lower() for role in user.get("roles", ["member"])]
        legacy_source = source if source.startswith("legacy_") else f"legacy_{source}"
        await _enforce_login_mfa(
            tenant_id,
            username,
            otp_code,
            source=legacy_source,
        )
        return username, tenant_id, roles, True, None

    raise HTTPException(status_code=401, detail="Username or password incorrect")


def _create_access_token(username: str, tenant_id: str, roles: list[str]) -> LoginResponse:
    expires_delta = timedelta(minutes=_jwt_ttl_minutes())
    expire_at = datetime.now(timezone.utc) + expires_delta
    payload = {
        "sub": username,
        "tenant_id": tenant_id,
        "roles": roles,
        "exp": int(expire_at.timestamp()),
    }
    token = jwt.encode(payload, _jwt_secret(), algorithm=ALGORITHM)
    return LoginResponse(access_token=token, expires_in=int(expires_delta.total_seconds()))


def _build_mobile_edge_id(tenant_id: str, device_info: dict[str, Any]) -> tuple[str, str]:
    raw_device_id = str(
        device_info.get("device_id")
        or device_info.get("device_fingerprint")
        or device_info.get("installation_id")
        or uuid.uuid4().hex[:12]
    ).strip()
    safe_device_id = re.sub(r"[^a-zA-Z0-9_-]+", "", raw_device_id)[:32] or uuid.uuid4().hex[:12]
    tenant_slug = re.sub(r"[^a-zA-Z0-9_-]+", "", str(tenant_id or "").strip())[:24] or "tenant"
    return f"mobile_{tenant_slug}_{safe_device_id}", safe_device_id


def _auth_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing bearer token",
    )


def _decode_legacy_user(token: str) -> UserClaims | None:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[ALGORITHM])
        return UserClaims(**payload)
    except (JWTError, ValueError, RuntimeError):
        return None


async def _decode_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> UserClaims:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _auth_error()

    token = credentials.credentials.strip()
    legacy_claims = _decode_legacy_user(token)
    if legacy_claims is not None:
        return legacy_claims

    auth_user = await get_user_from_access_token(token)
    if auth_user is not None:
        mapped = claims_from_user(auth_user)
        return UserClaims(
            sub=mapped.sub,
            tenant_id=mapped.tenant_id,
            roles=mapped.roles,
            exp=int((datetime.now(timezone.utc) + timedelta(minutes=_jwt_ttl_minutes())).timestamp()),
        )
    raise _auth_error()


async def _resolve_claims_from_auth_header(header_value: str | None) -> UserClaims | None:
    if not header_value:
        return None
    raw = header_value.strip()
    if not raw.lower().startswith("bearer "):
        return None
    token = raw.split(" ", 1)[1].strip()
    if not token:
        return None
    legacy_claims = _decode_legacy_user(token)
    if legacy_claims is not None:
        return legacy_claims

    auth_user = await get_user_from_access_token(token)
    if auth_user is not None:
        mapped = claims_from_user(auth_user)
        return UserClaims(
            sub=mapped.sub,
            tenant_id=mapped.tenant_id,
            roles=mapped.roles,
            exp=int((datetime.now(timezone.utc) + timedelta(minutes=_jwt_ttl_minutes())).timestamp()),
        )
    return None


async def _decode_oidc_claims(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict[str, Any]:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _auth_error()
    token = credentials.credentials.strip()
    try:
        claims = get_oidc_provider().verify_token(token)
    except Exception as exc:
        raise _auth_error() from exc
    if str(claims.get("token_use") or "").strip().lower() not in {"access", "id"}:
        raise _auth_error()
    return claims


async def _decode_scim_principal(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> ScimPrincipal:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid or missing SCIM bearer token",
            headers={"WWW-Authenticate": 'Bearer realm="scim"'},
        )

    token = credentials.credentials.strip()
    configured_token = _scim_bearer_token()
    if configured_token and secrets.compare_digest(token, configured_token):
        tenant_id = str(request.headers.get("x-tenant-id") or "").strip() or _scim_default_tenant()
        return ScimPrincipal(tenant_id=tenant_id, actor_id="scim_provisioner", auth_mode="scim_token")

    claims = await _resolve_claims_from_auth_header(f"Bearer {token}")
    if claims is not None and "admin" in claims.roles:
        tenant_id = str(request.headers.get("x-tenant-id") or claims.tenant_id).strip() or claims.tenant_id
        return ScimPrincipal(tenant_id=tenant_id, actor_id=claims.sub, auth_mode="admin_jwt")

    raise HTTPException(
        status_code=401,
        detail="Invalid or missing SCIM bearer token",
        headers={"WWW-Authenticate": 'Bearer realm="scim"'},
    )


def _verify_edge_secret(
    x_edge_secret: str | None = Header(default=None),
    x_edge_node_id: str | None = Header(default=None),
    x_timestamp: str | None = Header(default=None),
    x_nonce: str | None = Header(default=None),
    x_signature: str | None = Header(default=None),
) -> None:
    candidate_secrets: list[str] = []
    edge_node_id = str(x_edge_node_id or "").strip()
    try:
        from mobile_pairing import get_mobile_pairing_store

        mobile_device = get_mobile_pairing_store().find_device_by_edge_id(edge_node_id)
        mobile_secret = str((mobile_device or {}).get("edge_secret") or "").strip()
        if mobile_secret:
            candidate_secrets.append(mobile_secret)
    except Exception:
        pass

    expected = _edge_secret()
    candidate_secrets.append(expected)

    if x_edge_secret:
        for secret_value in candidate_secrets:
            if secret_value and secrets.compare_digest(x_edge_secret, secret_value):
                return
    try:
        edge_auth = _load_edge_auth_module()
        for secret_value in candidate_secrets:
            if not secret_value:
                continue
            ok = edge_auth.EdgeAuthManager.verify(
                edge_node_id,
                str(x_timestamp or "").strip(),
                str(x_nonce or "").strip(),
                str(x_signature or "").strip(),
                secret_value,
                max_age_sec=60,
            )
            if ok:
                return
    except Exception:
        pass
    raise HTTPException(status_code=401, detail="Invalid edge secret")


def _verify_hitl_secret(x_hitl_secret: str | None = Header(default=None)) -> None:
    expected = _hitl_secret()
    if not x_hitl_secret or not secrets.compare_digest(x_hitl_secret, expected):
        raise HTTPException(status_code=401, detail="Invalid hitl secret")


async def _notify_hitl_to_telegram(approval: dict[str, Any]) -> None:
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not bot_token:
        return
    chat_id = str(approval.get("scope", {}).get("user_id") or os.getenv("TELEGRAM_APPROVAL_CHAT_ID", "")).strip()
    if not chat_id:
        return
    http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
    if http_client is None:
        return

    score = approval.get("scope", {}).get("score")
    lead_count = approval.get("scope", {}).get("lead_count")
    task_desc = str(approval.get("scope", {}).get("task_description", ""))[:180]
    approval_id = approval.get("approval_id")

    message = (
        "⚠️ HITL 审批请求\n"
        f"approval_id: {approval_id}\n"
        f"score: {score}\n"
        f"lead_count: {lead_count}\n"
        f"task: {task_desc}\n\n"
        f"/approve {approval_id}\n"
        f"/reject {approval_id}"
    )
    try:
        await http_client.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": message},
            timeout=15.0,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[HITL notify error] {exc}")


async def _notify_hitl_to_mobile_channels(approval: dict[str, Any], *, phase: str) -> dict[str, Any]:
    http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
    if http_client is None:
        return {"phase": phase, "results": []}

    approval_id = str(approval.get("approval_id") or "").strip()
    scope = approval.get("scope", {}) if isinstance(approval.get("scope"), dict) else {}
    score = scope.get("score")
    lead_count = scope.get("lead_count")
    task_desc = str(scope.get("task_description", "") or "")[:180]
    mobile_base = os.getenv("MOBILE_APPROVAL_BASE_URL", "").strip() or os.getenv("PUBLIC_BASE_URL", "").strip()
    mobile_link = f"{mobile_base.rstrip('/')}/client-mobile?approval_id={approval_id}" if mobile_base else approval_id
    decision = str(approval.get("status") or approval.get("decision") or "pending").strip().lower()
    reason = str(approval.get("reason") or "").strip()

    if phase == "request":
        message = (
            "Lobster Pool HITL approval needed\n"
            f"approval_id: {approval_id}\n"
            f"score: {score}\n"
            f"lead_count: {lead_count}\n"
            f"task: {task_desc}\n"
            f"mobile: {mobile_link}"
        )
    else:
        message = (
            "Lobster Pool HITL approval updated\n"
            f"approval_id: {approval_id}\n"
            f"decision: {decision}\n"
            f"reason: {reason or 'manual_decision'}\n"
            f"mobile: {mobile_link}"
        )

    results: list[dict[str, Any]] = []
    feishu_chat_id = os.getenv("FEISHU_APPROVAL_CHAT_ID", "").strip() or str(scope.get("user_id") or "").strip() or "approval"
    dingtalk_chat_id = os.getenv("DINGTALK_APPROVAL_CHAT_ID", "").strip() or str(scope.get("user_id") or "").strip() or "approval"

    if getattr(app.state, "feishu_channel", feishu_channel).enabled:
        try:
            sent = await getattr(app.state, "feishu_channel", feishu_channel).reply(
                chat_id=feishu_chat_id,
                text=message,
                client=http_client,
            )
            results.append({"channel": "feishu", **sent})
        except Exception as exc:  # noqa: BLE001
            results.append({"channel": "feishu", "ok": False, "reason": str(exc)})

    if getattr(app.state, "dingtalk_channel", dingtalk_channel).enabled:
        try:
            sent = await getattr(app.state, "dingtalk_channel", dingtalk_channel).reply(
                chat_id=dingtalk_chat_id,
                text=message,
                client=http_client,
            )
            results.append({"channel": "dingtalk", **sent})
        except Exception as exc:  # noqa: BLE001
            results.append({"channel": "dingtalk", "ok": False, "reason": str(exc)})

    if os.getenv("TELEGRAM_BOT_TOKEN", "").strip():
        try:
            await _notify_hitl_to_telegram(approval)
            results.append({"channel": "telegram", "ok": True})
        except Exception as exc:  # noqa: BLE001
            results.append({"channel": "telegram", "ok": False, "reason": str(exc)})

    return {"phase": phase, "results": results}


async def _store_hitl_record(approval: dict[str, Any]) -> None:
    approval_id = str(approval.get("approval_id", "")).strip()
    if not approval_id:
        return
    app.state.hitl_pending[approval_id] = approval
    redis: Redis | None = getattr(app.state, "redis", None)
    if redis is None:
        return
    key = f"hitl:approval:{approval_id}"
    await redis.hset(
        key,
        mapping={
            "status": "pending",
            "payload": json.dumps(approval, ensure_ascii=False),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    await redis.expire(key, 3600)
    await redis.zadd("hitl:pending:index", {approval_id: time.time()})
    await redis.expire("hitl:pending:index", 3600)


async def _hitl_request_hook(payload: dict[str, Any]) -> dict[str, Any]:
    await _store_hitl_record(payload)
    push_result = await _notify_hitl_to_mobile_channels(payload, phase="request")
    approval_id = str(payload.get("approval_id", "")).strip()
    if approval_id:
        app.state.hitl_pending[approval_id] = {
            **(app.state.hitl_pending.get(approval_id) or {}),
            "mobile_push": push_result,
        }
    return {"approval_id": payload.get("approval_id"), "status": "pending"}


async def _read_hitl_status(approval_id: str) -> dict[str, Any]:
    record = app.state.hitl_pending.get(approval_id, {})
    status = str(record.get("status", "pending")).lower()

    redis: Redis | None = getattr(app.state, "redis", None)
    if redis is not None:
        key = f"hitl:approval:{approval_id}"
        data = await redis.hgetall(key)
        if data:
            redis_status = str(data.get("status", status)).lower()
            if redis_status:
                status = redis_status
            if "decision_payload" in data:
                try:
                    decision_payload = json.loads(data["decision_payload"])
                    if isinstance(decision_payload, dict):
                        return decision_payload
                except json.JSONDecodeError:
                    pass

    if status in {"approved", "rejected"}:
        return {
            "decision": status,
            "reason": str(record.get("reason", "")) or "manual_decision",
            "operator": record.get("operator"),
        }
    return {"decision": "pending", "reason": "awaiting_human_confirmation"}


async def _hitl_await_hook(approval_id: str, timeout_sec: int) -> dict[str, Any]:
    deadline = time.time() + max(5, timeout_sec)
    while time.time() < deadline:
        status = await _read_hitl_status(approval_id)
        if status.get("decision") in {"approved", "rejected"}:
            return status
        await asyncio.sleep(2.0)
    return {"decision": "rejected", "reason": "approval_timeout"}


async def _set_hitl_decision(approval_id: str, decision: str, operator: str, reason: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    record = app.state.hitl_pending.get(approval_id) or {"approval_id": approval_id}
    record.update(
        {
            "status": decision,
            "operator": operator,
            "reason": reason,
            "updated_at": now,
        }
    )
    push_result = await _notify_hitl_to_mobile_channels(record, phase="decision")
    record["mobile_push"] = push_result
    app.state.hitl_pending[approval_id] = record
    decision_payload = {
        "decision": decision,
        "reason": reason or "manual_decision",
        "operator": operator,
        "updated_at": now,
    }
    redis: Redis | None = getattr(app.state, "redis", None)
    if redis is not None:
        key = f"hitl:approval:{approval_id}"
        await redis.hset(
            key,
            mapping={
                "status": decision,
                "updated_at": now,
                "decision_payload": json.dumps(decision_payload, ensure_ascii=False),
            },
        )
        await redis.expire(key, 3600)
        await redis.zrem("hitl:pending:index", approval_id)
    return {"approval_id": approval_id, "status": decision_payload}


async def _store_run_job_record(record: dict[str, Any]) -> None:
    job_id = str(record.get("job_id", "")).strip()
    if not job_id:
        return
    app.state.run_dragon_jobs[job_id] = record
    redis: Redis | None = getattr(app.state, "redis", None)
    if redis is None:
        return
    key = f"run_dragon:job:{job_id}"
    await redis.hset(
        key,
        mapping={
            "status": str(record.get("status", "queued")),
            "tenant_id": str(record.get("tenant_id", "")),
            "user_id": str(record.get("user_id", "")),
            "updated_at": str(record.get("updated_at", datetime.now(timezone.utc).isoformat())),
            "payload": json.dumps(record, ensure_ascii=False),
        },
    )
    await redis.expire(key, 3600 * 24)
    await redis.zadd(f"run_dragon:jobs:index:{record.get('tenant_id', '')}", time.time(), job_id)
    await redis.expire(f"run_dragon:jobs:index:{record.get('tenant_id', '')}", 3600 * 24)


async def _read_run_job_record(job_id: str) -> dict[str, Any]:
    record = app.state.run_dragon_jobs.get(job_id)
    if isinstance(record, dict):
        return record
    redis: Redis | None = getattr(app.state, "redis", None)
    if redis is None:
        return {}
    key = f"run_dragon:job:{job_id}"
    data = await redis.hgetall(key)
    if not data:
        return {}
    try:
        payload = json.loads(data.get("payload", "{}"))
        if isinstance(payload, dict):
            app.state.run_dragon_jobs[job_id] = payload
            return payload
    except json.JSONDecodeError:
        return {}
    return {}


async def _update_run_job_record(job_id: str, **patch: Any) -> dict[str, Any]:
    current = dict(await _read_run_job_record(job_id) or {})
    current.update(patch)
    current["job_id"] = job_id
    current["updated_at"] = datetime.now(timezone.utc).isoformat()
    await _store_run_job_record(current)
    return current


def _schedule_post_mission_intent_prediction(
    *,
    tenant_id: str,
    task_id: str,
    task_summary: str,
) -> None:
    async def _runner() -> None:
        try:
            from intent_predictor import predict_next_intents, store_predicted_intents
            from lobsters.followup import FollowUpLobster

            followup_lobster = FollowUpLobster()
            if hasattr(followup_lobster, "bind_runtime_context"):
                followup_lobster.bind_runtime_context(tenant_id)
            intents = await predict_next_intents(
                llm_router=llm_router,
                task_summary=task_summary,
                tenant_id=tenant_id,
            )
            await store_predicted_intents(
                intents,
                lobster=followup_lobster,
                task_id=task_id,
                tenant_id=tenant_id,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Post-mission intent prediction failed: %s", exc)

    asyncio.create_task(_runner(), name=f"intent-predict:{task_id}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_url = os.getenv("DATABASE_URL", "").strip()
    allow_inmemory = os.getenv("ALLOW_INMEMORY_CHECKPOINTER", "true").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    checkpointer_cm = None
    redis: Redis | None = None

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            app.state.langsmith = _configure_langsmith()
            await init_auth_schema()
            app.state.auth_bootstrap = await ensure_bootstrap_admin()
            await init_billing_schema()
            ensure_clawteam_schema()
            ensure_clawwork_schema()
            ensure_lossless_memory_schema()
            ensure_memory_governor_schema()
            ensure_policy_bandit_schema()
            ensure_research_radar_schema()
            ensure_industry_kb_schema()
            ensure_industry_starter_kit_schema()
            ensure_agent_model_registry_schema()
            ensure_agent_extension_registry_schema()
            ensure_edge_rewards_schema()
            ensure_edge_resource_governor_schema()
            ensure_otp_relay_schema()
            ensure_followup_subagent_schema()
            ensure_agent_rag_pack_schema()
            get_feature_flag_client()
            get_lifecycle_manager().ensure_registry_shape()
            start_llm_log_flusher()
            if db_url:
                try:
                    if AsyncPostgresSaver is None:
                        raise RuntimeError("langgraph.checkpoint.postgres not installed")
                    checkpointer_cm = AsyncPostgresSaver.from_conn_string(db_url)
                    checkpointer = await checkpointer_cm.__aenter__()
                    await checkpointer.setup()
                    app.state.main_graph = dragon_graph.compile(checkpointer=checkpointer)
                    app.state.dm_graph = dm_graph.compile(checkpointer=checkpointer)
                    app.state.checkpointer_mode = "postgres"
                except Exception as exc:  # noqa: BLE001
                    if not allow_inmemory:
                        raise
                    app.state.main_graph = dragon_graph.compile()
                    app.state.dm_graph = dm_graph.compile()
                    app.state.checkpointer_mode = f"memory_fallback: {exc}"
            else:
                app.state.main_graph = dragon_graph.compile()
                app.state.dm_graph = dm_graph.compile()
                app.state.checkpointer_mode = "memory_no_database_url"

            try:
                redis = Redis.from_url(_redis_url(), decode_responses=True)
                await redis.ping()
                app.state.redis_mode = "connected"
            except Exception as exc:  # noqa: BLE001
                redis = None
                app.state.redis_mode = f"fallback_memory: {exc}"

            app.state.checkpointer_cm = checkpointer_cm
            app.state.redis = redis
            app.state.http_client = client
            app.state.app_boot_id = str(uuid.uuid4())
            app.state.edge_outbox: dict[str, list[dict[str, Any]]] = {}
            app.state.edge_registry: dict[str, dict[str, Any]] = {}

            async def _edge_push_sender(node_id: str, batch_payload: dict[str, Any], entries: list[Any]) -> dict[str, Any]:
                registry = getattr(app.state, "edge_registry", {}) or {}
                row = registry.get(node_id, {}) if isinstance(registry, dict) else {}
                webhook_url = str((row or {}).get("webhook_url") or "").strip()
                if not webhook_url:
                    for entry in entries:
                        candidate = str(getattr(entry, "webhook_url", "") or "").strip()
                        if candidate:
                            webhook_url = candidate
                            break
                if not webhook_url:
                    return {"accepted": False}
                response = await client.post(webhook_url, json=batch_payload)
                if response.status_code < 400:
                    return {
                        "accepted": True,
                        "delivered_ids": [str(getattr(entry, "outbox_id", "")) for entry in entries],
                    }
                return {"accepted": False}

            edge_outbox_manager = EdgeOutbox(sender=_edge_push_sender)
            app.state.edge_outbox_manager = edge_outbox_manager
            app.state.edge_outbox_flush_task = asyncio.create_task(
                edge_outbox_manager.flush_loop(),
                name="edge-outbox-flush",
            )
            try:
                from bridge_protocol import get_bridge_manager

                get_bridge_manager().set_outbox(edge_outbox_manager)
            except Exception:
                pass
            heartbeat_engine = get_heartbeat_engine()
            heartbeat_engine.start()
            app.state.heartbeat_engine = heartbeat_engine
            active_checker = get_active_checker("tenant_main")
            active_checker.bind_runtime_providers(
                edge_registry_provider=lambda: getattr(app.state, "edge_registry", {}),
                edge_outbox_provider=lambda: _edge_outbox_runtime_view(),
            )
            active_checker.start()
            app.state.active_heartbeat_checker = active_checker
            alert_engine = get_alert_engine()
            alert_engine.start()
            app.state.alert_engine = alert_engine
            channel_account_manager.reload_from_env()
            app.state.channel_account_manager = channel_account_manager
            print(f"[startup] 渠道账号管理器已加载: {channel_account_manager.get_all_enabled_channels()}")
            feishu_channel.reload_from_env()
            dingtalk_channel.reload_from_env()
            app.state.feishu_channel = feishu_channel
            app.state.dingtalk_channel = dingtalk_channel
            app.state.chat_route_map: dict[str, dict[str, Any]] = {}
            app.state.webhook_replay_cache: dict[str, float] = {}
            app.state.kernel_reports: dict[str, dict[str, Any]] = {}
            app.state.hitl_pending: dict[str, dict[str, Any]] = {}
            app.state.run_dragon_jobs: dict[str, dict[str, Any]] = {}
            app.state.run_dragon_background_tasks: set[asyncio.Task[Any]] = set()
            app.state.campaign_simulations: dict[str, dict[str, Any]] = {}
            app.state.dlp_alerts: list[dict[str, Any]] = []
            app.state.feature_flag_ws_clients: set[WebSocket] = set()
            app.state.execution_log_ws_clients: set[WebSocket] = set()
            # 后台任务：把 step_event_queue 里的事件广播到 /ws/execution-logs 订阅者
            async def _step_event_bridge_loop() -> None:
                from api_lobster_realtime import get_step_event_queue
                q = get_step_event_queue()
                while True:
                    try:
                        event = await asyncio.wait_for(q.get(), timeout=1.0)
                        d = event.to_dict() if hasattr(event, "to_dict") else dict(event)
                        d["type"] = "step_event"
                        await _broadcast_execution_log(d)
                    except asyncio.TimeoutError:
                        pass
                    except Exception:
                        pass
            app.state.step_bridge_task = asyncio.create_task(
                _step_event_bridge_loop(), name="step-event-bridge"
            )
            app.state.scheduler_store = scheduler_store
            app.state.scheduler = scheduler
            app.state.workflow_engine = workflow_engine
            app.state.session_manager = session_mgr
            app.state.policy_engine = get_policy_engine()
            app.state.policy_bundle_manager = get_policy_bundle_manager()
            app.state.decision_logger = get_decision_logger()
            app.state.mcp_gateway = get_mcp_gateway()
            await app.state.mcp_gateway.start()
            from lobster_trigger_rules import get_lobster_trigger_engine
            app.state.lobster_trigger_engine = get_lobster_trigger_engine(
                action_runner=_trigger_rule_action_runner,
                eval_interval=int(os.getenv("LOBSTER_TRIGGER_EVAL_INTERVAL_SEC", "60") or 60),
            )
            app.state.lobster_trigger_engine.start()
            scheduler_task = asyncio.create_task(scheduler.run(), name="cron-scheduler")
            app.state.scheduler_task = scheduler_task
            app.state.audit_cleanup_task = asyncio.create_task(_audit_cleanup_loop(), name="audit-cleanup")
            app.state.vector_backup_stop_event = asyncio.Event()
            app.state.vector_backup_task = asyncio.create_task(
                run_vector_backup_daily_loop(app.state.vector_backup_stop_event),
                name="vector-backup-loop",
            )

            async def delivery_hook(message: dict[str, Any]) -> dict[str, Any]:
                edge_id = str(message.get("edge_id") or "")
                webhook_url = str(message.get("webhook_url") or "").strip()
                outbox_manager = _edge_outbox_manager()

                if edge_id and outbox_manager is not None:
                    outbox_id = await outbox_manager.enqueue(
                        tenant_id=str(message.get("tenant_id") or "tenant_main"),
                        node_id=edge_id,
                        msg_type=str(message.get("type") or message.get("msg_type") or "edge_message"),
                        payload=message,
                        delivery_mode="push" if webhook_url else "poll",
                        webhook_url=webhook_url,
                    )
                    return {
                        "accepted": True,
                        "transport": "push_outbox" if webhook_url else "poll_queue",
                        "detail": "Queued in durable edge outbox",
                        "outbox_id": outbox_id,
                    }

                if edge_id:
                    app.state.edge_outbox.setdefault(edge_id, []).append(message)

                if not webhook_url:
                    return {
                        "accepted": True,
                        "transport": "poll_queue",
                        "detail": "Queued for edge polling",
                    }

                try:
                    response = await client.post(webhook_url, json=message)
                    if response.status_code < 400:
                        return {
                            "accepted": True,
                            "transport": "webhook",
                            "detail": f"Webhook delivered ({response.status_code})",
                        }
                    return {
                        "accepted": False,
                        "transport": "webhook",
                        "detail": f"Webhook failed ({response.status_code})",
                    }
                except Exception as exc:  # noqa: BLE001
                    return {
                        "accepted": False,
                        "transport": "webhook",
                        "detail": f"Webhook exception: {exc}",
                    }

            set_edge_delivery_hook(delivery_hook)
            set_human_approval_hooks(_hitl_request_hook, _hitl_await_hook)
            llm_router.set_model_binding_resolver(
                lambda tenant_id, task_type: resolve_llm_binding_for_task(
                    tenant_id=tenant_id,
                    task_type=task_type,
                )
            )
            yield
        finally:
            set_edge_delivery_hook(None)
            set_human_approval_hooks(None, None)
            llm_router.set_model_binding_resolver(None)
            scheduler_task = getattr(app.state, "scheduler_task", None)
            if scheduler_task is not None:
                scheduler.stop()
                scheduler_task.cancel()
                try:
                    await scheduler_task
                except asyncio.CancelledError:
                    pass
            audit_cleanup_task = getattr(app.state, "audit_cleanup_task", None)
            if audit_cleanup_task is not None:
                audit_cleanup_task.cancel()
                try:
                    await audit_cleanup_task
                except asyncio.CancelledError:
                    pass
            vector_backup_stop_event = getattr(app.state, "vector_backup_stop_event", None)
            if vector_backup_stop_event is not None:
                vector_backup_stop_event.set()
            vector_backup_task = getattr(app.state, "vector_backup_task", None)
            if vector_backup_task is not None:
                vector_backup_task.cancel()
                try:
                    await vector_backup_task
                except asyncio.CancelledError:
                    pass
            heartbeat_engine = getattr(app.state, "heartbeat_engine", None)
            if heartbeat_engine is not None:
                heartbeat_engine.stop()
            active_checker = getattr(app.state, "active_heartbeat_checker", None)
            if active_checker is not None:
                active_checker.stop()
            edge_outbox_manager = getattr(app.state, "edge_outbox_manager", None)
            if edge_outbox_manager is not None:
                edge_outbox_manager.stop()
            edge_outbox_flush_task = getattr(app.state, "edge_outbox_flush_task", None)
            if edge_outbox_flush_task is not None:
                edge_outbox_flush_task.cancel()
                try:
                    await edge_outbox_flush_task
                except asyncio.CancelledError:
                    pass
            mcp_gateway = getattr(app.state, "mcp_gateway", None)
            if mcp_gateway is not None:
                await mcp_gateway.stop()
            lobster_trigger_engine = getattr(app.state, "lobster_trigger_engine", None)
            if lobster_trigger_engine is not None:
                await lobster_trigger_engine.stop()
            await workflow_engine.aclose()
            if getattr(app.state, "alert_engine", None) is not None:
                await app.state.alert_engine.stop()
            stop_llm_log_flusher()
            if redis is not None:
                await redis.close()
            if checkpointer_cm is not None:
                await checkpointer_cm.__aexit__(None, None, None)


app = FastAPI(
    title="Dragon Senate SaaS Mainland v3",
    version="3.1.0",
    lifespan=lifespan,
)

_SCHEDULER_CHECK_INTERVAL_SEC = float(os.getenv("SCHEDULER_CHECK_INTERVAL_SEC", "10") or 10)
scheduler_store = SchedulerStore(os.getenv("SCHEDULER_DB_PATH", "./data/scheduler.sqlite"))
session_mgr = get_session_manager()
app.include_router(search_router)
app.include_router(realtime_router)
app.include_router(edge_telemetry_router)
app.include_router(admin_router)
_observability_router = make_observability_router()
if _observability_router is not None:
    app.include_router(_observability_router)


def _build_scheduler_runtime_lobster(role_id: str):
    from lobsters.base_lobster import BaseLobster

    runtime_cls = type(f"Scheduled{role_id.title()}Runtime", (BaseLobster,), {"role_id": role_id})
    return runtime_cls()


def _build_runtime_lobster(role_id: str, tenant_id: str):
    lobster = _build_scheduler_runtime_lobster(role_id)
    if hasattr(lobster, "bind_runtime_context"):
        try:
            lobster.bind_runtime_context(tenant_id)
        except Exception:
            pass
    return lobster


_WIDGET_SERVER_MODULE = None
_EDGE_AUTH_MODULE = None
_RULE_ENGINE_READY = False


def _load_widget_server_module():
    global _WIDGET_SERVER_MODULE
    if _WIDGET_SERVER_MODULE is not None:
        return _WIDGET_SERVER_MODULE
    module_path = Path(__file__).resolve().parent.parent / "edge-runtime" / "widget_server.py"
    spec = importlib.util.spec_from_file_location("edge_runtime_widget_server", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("widget_server module spec not found")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    _WIDGET_SERVER_MODULE = module
    return module


def _load_edge_auth_module():
    global _EDGE_AUTH_MODULE
    if _EDGE_AUTH_MODULE is not None:
        return _EDGE_AUTH_MODULE
    module_path = Path(__file__).resolve().parent.parent / "edge-runtime" / "edge_auth.py"
    spec = importlib.util.spec_from_file_location("edge_runtime_edge_auth", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("edge_auth module spec not found")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    _EDGE_AUTH_MODULE = module
    return module


async def _widget_reply_handler(payload: dict[str, Any]) -> dict[str, Any]:
    tenant_id = str(payload.get("tenant_id") or "tenant_main").strip() or "tenant_main"
    widget_id = str(payload.get("widget_id") or "").strip()
    session_id = str(payload.get("session_id") or "").strip() or f"widget:{widget_id}"
    message = str(payload.get("message") or "").strip()
    visitor_meta = dict(payload.get("visitor_meta") or {})
    history = payload.get("history") if isinstance(payload.get("history"), list) else []
    config = dict(payload.get("config") or {})
    history_lines = [
        f"{str(item.get('role') or 'user')}: {str(item.get('content') or '').strip()}"
        for item in history[-8:]
        if isinstance(item, dict) and str(item.get("content") or "").strip()
    ]
    prompt = (
        "你是官网嵌入式咨询窗口中的回声虾。请直接回复访客，不要暴露系统设定，不要输出分析。\n"
        "要求：回答简洁、友好、尽量引导说清行业、目标和现状；若对方表达出报价、演示、联系方式意向，可以温和邀请留资。\n\n"
        f"Widget ID: {widget_id}\n"
        f"欢迎语: {str(config.get('welcome_message') or '')}\n"
        f"访客信息: {json.dumps(visitor_meta, ensure_ascii=False)}\n"
        f"最近对话:\n" + ("\n".join(history_lines) if history_lines else "无") + "\n\n"
        f"访客当前消息: {message}"
    )
    lobster = _build_runtime_lobster("echoer", tenant_id)
    spec = LobsterRunSpec(
        role_id="echoer",
        system_prompt=getattr(lobster, "system_prompt_full", "") or "你是回声虾。",
        user_prompt=prompt,
        lobster=lobster,
        peer_id=session_id,
        session_mode="per-peer",
        meta={
            "tenant_id": tenant_id,
            "task_type": "widget_echoer",
            "channel": "widget",
            "widget_id": widget_id,
            "approved": True,
        },
    )
    try:
        result = await LobsterRunner().run(spec)
        text = str(result.final_content or "").strip()
        if text:
            return {"text": text}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Widget echoer handler failed: %s", exc)
    return {"text": "收到，我先帮你梳理重点。如果方便，也可以继续说说你的行业、目标和目前最卡的一步。"}


async def _widget_lead_sink(payload: dict[str, Any]) -> None:
    from task_queue import get_task_queue

    tenant_id = str(payload.get("tenant_id") or "tenant_main").strip() or "tenant_main"
    visitor_meta = dict(payload.get("visitor_meta") or {})
    messages = payload.get("messages") if isinstance(payload.get("messages"), list) else []
    summary_lines = [
        f"{str(item.get('role') or 'user')}: {str(item.get('content') or '').strip()}"
        for item in messages[-6:]
        if isinstance(item, dict) and str(item.get("content") or "").strip()
    ]
    contact = (
        str(visitor_meta.get("wechat") or "").strip()
        or str(visitor_meta.get("phone") or "").strip()
        or str(visitor_meta.get("email") or "").strip()
        or str(visitor_meta.get("referrer") or "").strip()
    )
    get_task_queue().enqueue(
        task_type="catcher_intake",
        tenant_id=tenant_id,
        priority="high",
        payload={
            "lobster_name": "catcher",
            "title": f"[官网嵌入咨询] {str(visitor_meta.get('title') or '匿名访客')}",
            "description": "\n".join(summary_lines)[:2000],
            "source": "embed_widget",
            "contact": contact,
            "widget_id": str(payload.get("widget_id") or ""),
            "session_id": str(payload.get("session_id") or ""),
            "visitor_meta": visitor_meta,
        },
    )


def _get_widget_server():
    module = _load_widget_server_module()
    server = module.get_widget_server()
    server.set_handlers(reply_handler=_widget_reply_handler, lead_sink=_widget_lead_sink)
    return server


def _get_lobster_rule_engine():
    global _RULE_ENGINE_READY
    from lobster_auto_responder import LobsterAutoResponder
    from lobster_rule_engine import get_lobster_rule_engine

    engine = get_lobster_rule_engine()
    if not _RULE_ENGINE_READY:
        responder = LobsterAutoResponder(runtime_lobster_builder=_build_runtime_lobster)
        engine.register_action("dispatch_lobster", responder.handle_dispatch_lobster)
        engine.register_action("send_alert", responder.handle_send_alert)
        engine.register_action("update_field", responder.handle_update_field)
        engine.register_action("webhook", responder.handle_webhook)
        _RULE_ENGINE_READY = True
    return engine


def _resolve_policy_tenant_id(requested: str | None, current_user: UserClaims) -> str:
    target = str(requested or current_user.tenant_id).strip() or current_user.tenant_id
    if target not in {current_user.tenant_id, POLICY_GLOBAL_TENANT} and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Tenant access denied")
    return target


def _record_posthog_analytics_run(
    *,
    run_id: str,
    tenant_id: str,
    request: TaskRequest,
    result: dict[str, Any],
) -> None:
    try:
        from attribution_engine import AttributionTouchpoint, get_attribution_engine
        from funnel_analyzer import get_funnel_analyzer
    except Exception:
        return

    delivery_results = result.get("delivery_results", []) if isinstance(result.get("delivery_results"), list) else []
    leads = result.get("leads", []) if isinstance(result.get("leads"), list) else []
    followup_spawn = result.get("followup_spawn", {}) if isinstance(result.get("followup_spawn"), dict) else {}
    touchpoints: list[AttributionTouchpoint] = []

    if result.get("hot_topics"):
        touchpoints.append(AttributionTouchpoint(channel="signal", lobster_id="radar", value=1.0, meta={"topics": len(result.get("hot_topics") or [])}))
    if result.get("competitor_analysis") or result.get("content_package"):
        touchpoints.append(AttributionTouchpoint(channel="strategy", lobster_id="strategist", value=1.0))
    if result.get("content_package"):
        touchpoints.append(AttributionTouchpoint(channel="content", lobster_id="inkwriter", value=1.0))

    for row in delivery_results:
        if not isinstance(row, dict):
            continue
        channel_hint = str(row.get("transport") or row.get("account_id") or row.get("edge_id") or "delivery").strip() or "delivery"
        touchpoints.append(
            AttributionTouchpoint(
                channel=channel_hint,
                lobster_id="dispatcher",
                value=1.0 if bool(row.get("accepted")) else 0.2,
                meta={"accepted": bool(row.get("accepted"))},
            )
        )

    for lead in leads:
        if not isinstance(lead, dict):
            continue
        channel_hint = str(lead.get("channel") or lead.get("source") or "lead").strip() or "lead"
        lobster_id = "catcher" if "score" not in lead else "abacus"
        touchpoints.append(
            AttributionTouchpoint(
                channel=channel_hint,
                lobster_id=lobster_id,
                value=float(lead.get("score", 1.0) or 1.0),
                meta={"intent": lead.get("intent"), "grade": lead.get("grade")},
            )
        )

    if followup_spawn:
        touchpoints.append(AttributionTouchpoint(channel="followup", lobster_id="followup", value=1.0, meta=followup_spawn))

    conversion_value = float(result.get("score", 0.0) or 0.0) * 100.0
    if leads:
        conversion_value += float(len(leads)) * 10.0

    get_attribution_engine().record_run(
        run_id=run_id,
        tenant_id=tenant_id,
        touchpoints=touchpoints,
        conversion_value=conversion_value,
        industry_tag=str(request.industry_tag or ""),
        meta={"task_description": request.task_description[:200], "lead_count": len(leads)},
    )

    stage_flags = {
        "signal_collected": bool(result.get("hot_topics") or result.get("competitor_analysis")),
        "strategy_generated": bool(result.get("competitor_analysis") or result.get("content_package")),
        "content_generated": bool(result.get("content_package")),
        "delivered": any(bool(item.get("accepted")) for item in delivery_results if isinstance(item, dict)),
        "lead_captured": len(leads) > 0,
        "followup_triggered": bool(followup_spawn),
        "converted": any(float((item.get("score") or 0.0)) >= 0.85 for item in leads if isinstance(item, dict)),
    }
    channel_hint = ""
    if delivery_results:
        first = delivery_results[0]
        if isinstance(first, dict):
            channel_hint = str(first.get("transport") or first.get("account_id") or first.get("edge_id") or "")
    get_funnel_analyzer().record_run(
        run_id=run_id,
        tenant_id=tenant_id,
        stage_flags=stage_flags,
        industry_tag=str(request.industry_tag or ""),
        channel_hint=channel_hint,
        lead_count=len(leads),
        score=float(result.get("score", 0.0) or 0.0),
    )


def _survey_suggestions_for_event(event_type: str, *, current_user: UserClaims, task_id: str = "") -> list[dict[str, Any]]:
    try:
        from survey_engine import get_survey_engine
    except Exception:
        return []
    event = {
        "event_type": event_type,
        "tenant_id": current_user.tenant_id,
        "user_id": current_user.sub,
        "lobster_task_id": task_id,
    }
    try:
        return get_survey_engine().get_triggered_surveys(event)
    except Exception:
        return []


async def _trigger_rule_action_runner(rule: Any) -> None:
    action = getattr(rule, "action", None)
    if action is None:
        return
    action_type = str(getattr(action, "action_type", "") or "").strip()
    tenant_id = str(getattr(rule, "tenant_id", "") or "tenant_main").strip() or "tenant_main"
    if action_type == "invoke_lobster" and str(getattr(action, "lobster_name", "") or "").strip():
        lobster_name = str(getattr(action, "lobster_name") or "").strip()
        lobster = _build_runtime_lobster(lobster_name, tenant_id)
        spec = LobsterRunSpec(
            role_id=lobster_name,
            system_prompt=getattr(lobster, "system_prompt_full", "") or f"You are {lobster_name}.",
            user_prompt=str(getattr(action, "message", "") or "").strip() or f"Triggered by rule {getattr(rule, 'name', '')}",
            lobster=lobster,
            meta={
                "tenant_id": tenant_id,
                "task_type": "trigger_rule",
                "trigger_rule_id": str(getattr(rule, "rule_id", "") or ""),
                "trigger_rule_name": str(getattr(rule, "name", "") or ""),
                "source": "trigger_rule",
            },
        )
        await LobsterRunner().run(spec)
        return
    if action_type == "send_alert":
        try:
            from notification_center import send_notification

            await send_notification(
                tenant_id=tenant_id,
                message=str(getattr(action, "message", "") or "").strip() or f"trigger rule fired: {getattr(rule, 'name', '')}",
                level=str(getattr(action, "alert_level", "warn") or "warn"),
                category="trigger_rule",
            )
        except Exception:
            return


async def _execute_scheduled_lobster_task(task: ScheduledTask) -> str:
    lobster = _build_scheduler_runtime_lobster(task.lobster_id)
    prompt = str(task.prompt or "").strip()
    if not prompt:
        raise ValueError("scheduled task prompt is empty")

    session = get_session_manager().get_or_create(
        peer_id=f"cron-{task.task_id}",
        lobster_id=task.lobster_id,
        mode=task.session_mode.value,
        channel="scheduler",
        tenant_id=task.tenant_id,
    )

    runner = LobsterRunner(llm_router)
    spec = LobsterRunSpec(
        role_id=task.lobster_id,
        system_prompt=lobster.system_prompt_full or f"You are {lobster.display_name}.",
        user_prompt=prompt,
        session_id=session.session_id,
        session_mode=task.session_mode.value,
        peer_id=f"cron-{task.task_id}",
        lobster=lobster,
        meta={
            "tenant_id": task.tenant_id,
            "task_id": task.task_id,
            "task_type": "scheduled_task",
            "scheduler_task_id": task.task_id,
            "scheduler_task_name": task.name,
            "schedule_kind": task.kind.value,
            "delivery_channel": task.delivery_channel,
            "session_mode": task.session_mode.value,
            "channel": "scheduler",
            "peer_id": f"cron-{task.task_id}",
        },
    )
    result = await runner.run(spec)
    if result.final_content:
        return result.final_content
    if result.error:
        raise RuntimeError(result.error)
    return json.dumps(
        {
            "stop_reason": result.stop_reason,
            "usage": result.usage,
            "strategy_intensity": result.strategy_intensity,
        },
        ensure_ascii=False,
    )

workflow_runner = LobsterRunner(llm_router)
workflow_engine = WorkflowEngine(
    db_path=os.getenv("WORKFLOW_ENGINE_DB_PATH", "./data/workflow_engine.sqlite"),
    workflows_dir=os.getenv("WORKFLOW_DEFINITIONS_DIR", str(Path(__file__).resolve().parent / "workflows")),
    runner=workflow_runner,
    runtime_lobster_factory=_build_runtime_lobster,
)


def _derive_workflow_webhook_idempotency_key(
    webhook_id: str,
    request: Request,
    body_payload: dict[str, Any],
) -> str:
    header_key = (
        str(request.headers.get("x-idempotency-key") or "").strip()
        or str(request.headers.get("x-request-id") or "").strip()
    )
    if header_key:
        return header_key[:200]
    payload_fingerprint = hashlib.sha256(
        json.dumps(
            {
                "method": request.method,
                "query": sorted(request.query_params.multi_items()),
                "body": body_payload,
            },
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        ).encode("utf-8")
    ).hexdigest()[:24]
    return f"webhook:{webhook_id}:{int(time.time() // 300)}:{payload_fingerprint}"


async def _duplicate_workflow_run_payload(existing: dict[str, Any]) -> dict[str, Any]:
    existing_run_id = str(existing.get("run_id") or "").strip()
    status_payload = await workflow_engine.get_run_status(existing_run_id)
    try:
        from event_subjects import EventSubjects
        from webhook_event_bus import PlatformEvent, get_event_bus

        tenant_id = str(status_payload.get("tenant_id") or "tenant_main")
        workflow_id = str(status_payload.get("workflow_id") or "unknown")
        await get_event_bus().emit(
            PlatformEvent(
                event_type="workflow.execution.duplicate",
                subject=EventSubjects.format(
                    EventSubjects.TASK_EXECUTION_DUPLICATE,
                    tenant_id=tenant_id,
                    workflow_id=workflow_id,
                ),
                tenant_id=tenant_id,
                payload={
                    "run_id": existing_run_id,
                    "workflow_id": workflow_id,
                    "idempotency_key": existing.get("idempotency_key"),
                    "status": status_payload.get("status"),
                },
            )
        )
    except Exception:
        pass
    return {
        "ok": True,
        "duplicate": True,
        "run_id": existing_run_id,
        "status": str(status_payload.get("status") or existing.get("status") or RunStatus.QUEUED.value),
        "run": status_payload,
        "idempotency_key": existing.get("idempotency_key"),
    }


def _memory_service_base_url() -> str:
    return os.getenv("LOBSTER_MEMORY_API_BASE", "http://127.0.0.1:8000").strip().rstrip("/")

scheduler = CronScheduler(
    scheduler_store,
    _execute_scheduled_lobster_task,
    check_interval=_SCHEDULER_CHECK_INTERVAL_SEC,
)
register_scheduler_routes(app, scheduler, scheduler_store)
usecase_registry = UsecaseRegistry()
register_usecase_routes(app, usecase_registry)


@app.get("/api/workflow/list")
async def api_workflow_list(current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"ok": True, "workflows": list_workflow_definitions()}


@app.get("/api/v1/workflows")
async def api_workflow_catalog_v1(current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"ok": True, "workflows": list_workflow_definitions()}


@app.get("/api/v1/workflows/{workflow_id}")
async def api_workflow_detail_v1(workflow_id: str, current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from workflow_engine import load_workflow

    workflow = load_workflow(workflow_id, workflows_dir=workflow_engine.workflows_dir)
    return {
        "ok": True,
        "workflow": {
            "id": workflow.workflow_id,
            "name": workflow.name,
            "description": workflow.description,
            "steps": [
                {
                    "step_id": step.step_id,
                    "agent": step.agent,
                    "step_type": step.step_type,
                    "expects": step.expects,
                    "max_retries": step.max_retries,
                    "retry_delay_seconds": step.retry_delay_seconds,
                    "loop_over": step.loop_over,
                }
                for step in workflow.steps
            ],
            "agents": [{"id": agent.id, "lobster": agent.lobster} for agent in workflow.agents],
            "error_workflow_id": workflow.error_workflow_id,
            "error_notify_channels": workflow.error_notify_channels,
            "source_template_id": workflow.source_template_id,
        },
    }


@app.put("/api/v1/workflows/{workflow_id}")
async def api_workflow_update_v1(
    workflow_id: str,
    body: WorkflowDefinitionUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    try:
        payload = update_workflow_document(
            workflow_id,
            {
                "name": body.name,
                "description": body.description,
                "error_workflow_id": body.error_workflow_id,
                "error_notify_channels": body.error_notify_channels,
            },
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="workflow_not_found") from exc
    return {"ok": True, "workflow": payload}


@app.get("/api/v1/workflows/{workflow_id}/lifecycle")
async def api_workflow_lifecycle_v1(workflow_id: str, current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        from workflow_engine import load_workflow

        load_workflow(workflow_id, workflows_dir=workflow_engine.workflows_dir)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="workflow_not_found") from exc
    lifecycle = get_lifecycle_manager().get_workflow_lifecycle(workflow_id)
    return {"ok": True, "workflow_id": workflow_id, "lifecycle": lifecycle}


@app.put("/api/v1/workflows/{workflow_id}/lifecycle")
async def api_workflow_lifecycle_update_v1(
    workflow_id: str,
    body: WorkflowLifecycleChangeRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    try:
        event = await get_lifecycle_manager().change_workflow_lifecycle(
            workflow_id,
            WorkflowLifecycle(body.new_lifecycle),
            changed_by=current_user.sub,
            tenant_id=current_user.tenant_id,
            reason=body.reason,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="workflow_not_found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "event": event.__dict__}


@app.post("/api/workflow/run")
async def api_workflow_run(
    body: WorkflowRunRequest,
    request: Request,
    current_user: UserClaims = Depends(_decode_user),
):
    tenant_id = str(current_user.tenant_id or "").strip()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    idempotency_key = str(request.headers.get("x-idempotency-key") or body.idempotency_key or "").strip() or None
    reserved_run_id = str(uuid.uuid4())
    if idempotency_key:
        is_new, existing = get_workflow_idempotency_store().reserve_or_get_existing(
            tenant_id=tenant_id,
            workflow_id=body.workflow_id,
            idempotency_key=idempotency_key,
            run_id=reserved_run_id,
            trigger_source="manual",
        )
        if not is_new and existing:
            return await _duplicate_workflow_run_payload(existing)
    workflow_context = dict(body.context or {})
    industry_hint = str(body.industry or body.industry_tag or "").strip()
    if industry_hint:
        workflow_context.setdefault("industry", industry_hint)
        workflow_context.setdefault("industry_tag", industry_hint)
    if body.industry_workflow_context:
        workflow_context.setdefault("industry_workflow_context", dict(body.industry_workflow_context))
    try:
        run_id = await workflow_engine.start_run(
            run_id=reserved_run_id,
            tenant_id=tenant_id,
            workflow_id=body.workflow_id,
            task=body.task,
            context=workflow_context,
            notify_url=body.notify_url,
            idempotency_key=idempotency_key,
        )
        if idempotency_key:
            get_workflow_idempotency_store().rebind_run_id(
                tenant_id=tenant_id,
                workflow_id=body.workflow_id,
                idempotency_key=idempotency_key,
                run_id=run_id,
            )
    except QueueDepthExceededError as exc:
        if idempotency_key:
            get_workflow_idempotency_store().delete_reservation(
                tenant_id=tenant_id,
                workflow_id=body.workflow_id,
                idempotency_key=idempotency_key,
            )
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except WorkflowRateLimitedError as exc:
        if idempotency_key:
            get_workflow_idempotency_store().delete_reservation(
                tenant_id=tenant_id,
                workflow_id=body.workflow_id,
                idempotency_key=idempotency_key,
            )
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    status_payload = await workflow_engine.get_run_status(run_id)
    return {
        "ok": True,
        "duplicate": False,
        "run_id": run_id,
        "status": str(status_payload.get("status") or RunStatus.QUEUED.value),
        "run": status_payload,
        "idempotency_key": idempotency_key,
    }


@app.get("/api/workflow/run/{run_id}")
async def api_workflow_status(run_id: str, current_user: UserClaims = Depends(_decode_user)):
    status_payload = await workflow_engine.get_run_status(run_id)
    if not status_payload:
        raise HTTPException(status_code=404, detail="workflow_run_not_found")
    if (
        status_payload.get("tenant_id") != current_user.tenant_id
        and "admin" not in current_user.roles
    ):
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    return {"ok": True, "run": status_payload}


@app.post("/api/workflow/run/{run_id}/resume")
async def api_workflow_resume(run_id: str, current_user: UserClaims = Depends(_decode_user)):
    status_payload = await workflow_engine.get_run_status(run_id)
    if not status_payload:
        raise HTTPException(status_code=404, detail="workflow_run_not_found")
    if (
        status_payload.get("tenant_id") != current_user.tenant_id
        and "admin" not in current_user.roles
    ):
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    success = await workflow_engine.resume_run(run_id)
    return {"ok": True, "success": success}


@app.post("/api/workflow/run/{run_id}/pause")
async def api_workflow_pause(run_id: str, current_user: UserClaims = Depends(_decode_user)):
    status_payload = await workflow_engine.get_run_status(run_id)
    if not status_payload:
        raise HTTPException(status_code=404, detail="workflow_run_not_found")
    if (
        status_payload.get("tenant_id") != current_user.tenant_id
        and "admin" not in current_user.roles
    ):
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    success = await workflow_engine.pause_run(run_id)
    return {"ok": True, "success": success}


@app.get("/api/workflow/runs")
async def api_workflow_runs(
    limit: int = Query(default=20, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    tenant_id = str(current_user.tenant_id or "").strip()
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    runs = await workflow_engine.list_runs(tenant_id, limit=limit)
    return {"ok": True, "tenant_id": tenant_id, "count": len(runs), "runs": runs}


@app.get("/api/v1/workflows/{workflow_id}/executions")
async def api_workflow_executions(
    workflow_id: str,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    status: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    data = workflow_engine.store.list_runs_for_workflow(
        tenant_id=current_user.tenant_id,
        workflow_id=workflow_id,
        page=page,
        page_size=page_size,
        status=status,
    )
    return {"ok": True, "workflow_id": workflow_id, **data}


@app.get("/api/v1/workflows/executions/{execution_id}")
async def api_workflow_execution_detail(
    execution_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    record = await workflow_engine.get_run_status(execution_id)
    if not record:
        raise HTTPException(status_code=404, detail="execution_not_found")
    if record.get("tenant_id") != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    return {"ok": True, "execution": record}


@app.get("/api/v1/workflows/executions/{execution_id}/stream")
async def api_workflow_execution_stream(
    execution_id: str,
    request: Request,
    current_user: UserClaims = Depends(_decode_user),
):
    record = await workflow_engine.get_run_status(execution_id)
    if not record:
        raise HTTPException(status_code=404, detail="execution_not_found")
    if record.get("tenant_id") != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    return StreamingResponse(
        get_workflow_realtime_hub().stream(execution_id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/v1/workflows/executions/{execution_id}/replay")
async def api_workflow_execution_replay(
    execution_id: str,
    body: WorkflowReplayRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    status_payload = await workflow_engine.get_run_status(execution_id)
    if not status_payload:
        raise HTTPException(status_code=404, detail="execution_not_found")
    if status_payload.get("tenant_id") != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    try:
        new_execution_id = await workflow_engine.replay_run(
            execution_id,
            from_step_id=body.from_step_id,
        )
    except (QueueDepthExceededError, WorkflowRateLimitedError) as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return {"ok": True, "new_execution_id": new_execution_id, "replayed_from": execution_id}


@app.get("/api/v1/workflow-templates")
async def api_workflow_templates(
    category: str | None = Query(default=None),
    difficulty: str | None = Query(default=None),
    featured_only: bool = Query(default=False),
    search: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    items = get_workflow_template_gallery().list_templates(
        category=category,
        difficulty=difficulty,
        featured_only=featured_only,
        search=search,
    )
    return {"ok": True, "count": len(items), "templates": items}


@app.post("/api/v1/workflow-templates/{template_id}/use")
async def api_workflow_template_use(
    template_id: str,
    body: dict[str, Any],
    current_user: UserClaims = Depends(_decode_user),
):
    try:
        created = get_workflow_template_gallery().create_workflow_from_template(
            template_id=template_id,
            workflow_name=str(body.get("name") or "").strip() or None,
            tenant_id=current_user.tenant_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="template_not_found") from exc
    return {"ok": True, **created}


@app.get("/api/v1/workflows/{workflow_id}/webhooks")
async def api_workflow_webhooks(
    workflow_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    base_url = os.getenv("PUBLIC_BASE_URL", "").strip() or ""
    rows = [item.to_public_dict(base_url) for item in get_workflow_webhook_store().list_webhooks(workflow_id, current_user.tenant_id)]
    return {"ok": True, "workflow_id": workflow_id, "items": rows}


@app.post("/api/v1/workflows/{workflow_id}/webhooks")
async def api_workflow_webhook_create(
    workflow_id: str,
    body: WorkflowWebhookCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    created = get_workflow_webhook_store().create_webhook(
        workflow_id=workflow_id,
        tenant_id=current_user.tenant_id,
        name=body.name,
        http_method=body.http_method,
        auth_type=body.auth_type,
        auth_config=body.auth_config,
        response_mode=body.response_mode,
    )
    base_url = os.getenv("PUBLIC_BASE_URL", "").strip() or ""
    return {"ok": True, "webhook": created.to_public_dict(base_url)}


@app.delete("/api/v1/workflows/{workflow_id}/webhooks/{webhook_id}")
async def api_workflow_webhook_delete(
    workflow_id: str,
    webhook_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    deleted = get_workflow_webhook_store().delete_webhook(workflow_id, webhook_id, current_user.tenant_id)
    return {"ok": True, "deleted": deleted}


@app.api_route("/webhook/workflows/{webhook_id}", methods=["GET", "POST"])
async def receive_workflow_webhook(webhook_id: str, request: Request):
    webhook = get_workflow_webhook_store().get_active_webhook(webhook_id)
    if webhook is None:
        raise HTTPException(status_code=404, detail="workflow_webhook_not_found")
    if webhook.http_method != "ANY" and webhook.http_method != request.method:
        raise HTTPException(status_code=405, detail="webhook_method_not_allowed")
    try:
        verify_webhook_auth(webhook, {str(k).lower(): str(v) for k, v in request.headers.items()})
    except PermissionError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    body_payload: dict[str, Any] = {}
    if request.method == "POST":
        try:
            body_payload = await request.json()
        except Exception:
            body_payload = {"raw": (await request.body()).decode("utf-8", errors="ignore")}

    input_data = {
        "trigger_type": "webhook",
        "webhook_id": webhook_id,
        "http_method": request.method,
        "headers": dict(request.headers),
        "query_params": dict(request.query_params),
        "body": body_payload,
        "triggered_at": datetime.utcnow().isoformat(),
    }
    idempotency_key = _derive_workflow_webhook_idempotency_key(webhook_id, request, body_payload)
    reserved_run_id = str(uuid.uuid4())
    is_new, existing = get_workflow_idempotency_store().reserve_or_get_existing(
        tenant_id=webhook.tenant_id,
        workflow_id=webhook.workflow_id,
        idempotency_key=idempotency_key,
        run_id=reserved_run_id,
        trigger_source="webhook",
    )
    if not is_new and existing:
        payload = await _duplicate_workflow_run_payload(existing)
        if webhook.response_mode == "wait_for_completion" and payload.get("run"):
            return {"status": "duplicate", "duplicate": True, "run": payload.get("run"), "run_id": payload.get("run_id")}
        return {"status": "duplicate", "duplicate": True, "run_id": payload.get("run_id"), "run": payload.get("run")}
    get_workflow_webhook_store().touch_trigger(webhook_id)
    if webhook.response_mode == "wait_for_completion":
        try:
            run_id = await workflow_engine.start_run(
                run_id=reserved_run_id,
                tenant_id=webhook.tenant_id,
                workflow_id=webhook.workflow_id,
                task=f"Webhook trigger {webhook.name}",
                context=input_data,
                trigger_type="webhook",
                idempotency_key=idempotency_key,
            )
            get_workflow_idempotency_store().rebind_run_id(
                tenant_id=webhook.tenant_id,
                workflow_id=webhook.workflow_id,
                idempotency_key=idempotency_key,
                run_id=run_id,
            )
        except (QueueDepthExceededError, WorkflowRateLimitedError) as exc:
            get_workflow_idempotency_store().delete_reservation(
                tenant_id=webhook.tenant_id,
                workflow_id=webhook.workflow_id,
                idempotency_key=idempotency_key,
            )
            raise HTTPException(status_code=429, detail=str(exc)) from exc
        for _ in range(120):
            await asyncio.sleep(1)
            status_payload = await workflow_engine.get_run_status(run_id)
            if status_payload and status_payload.get("status") in {RunStatus.DONE.value, RunStatus.FAILED.value, RunStatus.CANCELLED.value}:
                return {"status": "completed", "run": status_payload}
        return {"status": "accepted", "run_id": run_id, "message": "workflow still running"}
    try:
        run_id = await workflow_engine.start_run(
            run_id=reserved_run_id,
            tenant_id=webhook.tenant_id,
            workflow_id=webhook.workflow_id,
            task=f"Webhook trigger {webhook.name}",
            context=input_data,
            trigger_type="webhook",
            idempotency_key=idempotency_key,
        )
        get_workflow_idempotency_store().rebind_run_id(
            tenant_id=webhook.tenant_id,
            workflow_id=webhook.workflow_id,
            idempotency_key=idempotency_key,
            run_id=run_id,
        )
    except (QueueDepthExceededError, WorkflowRateLimitedError) as exc:
        get_workflow_idempotency_store().delete_reservation(
            tenant_id=webhook.tenant_id,
            workflow_id=webhook.workflow_id,
            idempotency_key=idempotency_key,
        )
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return {"status": "accepted", "webhook_id": webhook_id, "run_id": run_id, "idempotency_key": idempotency_key}


@app.get("/api/v1/tenant/concurrency-stats")
async def api_tenant_concurrency_stats(current_user: UserClaims = Depends(_decode_user)):
    tenant_id = str(current_user.tenant_id or "").strip() or "tenant_main"
    manager = get_tenant_concurrency_manager()
    config = manager.get_tenant_config(tenant_id)
    current = await manager.get_stats(tenant_id)
    return {
        "ok": True,
        "tenant_id": tenant_id,
        "plan_tier": config.plan_tier,
        "current": current,
        "limits": {
            "max_concurrent_workflows": config.max_concurrent_workflows,
            "max_concurrent_steps": config.max_concurrent_steps,
            "max_queue_depth": config.max_queue_depth,
            "workflow_per_minute": config.workflow_per_minute,
        },
        "usage_pct": {
            "workflows": round((current["concurrent_workflows"] / max(1, config.max_concurrent_workflows)) * 100, 1),
            "steps": round((current["concurrent_steps"] / max(1, config.max_concurrent_steps)) * 100, 1),
        },
        "queue_depth": workflow_engine.store.count_runs_by_statuses(
            tenant_id,
            [RunStatus.QUEUED.value, RunStatus.RUNNING.value],
        ),
    }


@app.get("/api/v1/admin/concurrency-overview")
async def api_admin_concurrency_overview(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    manager = get_tenant_concurrency_manager()
    tenant_ids = workflow_engine.store.list_tenant_ids() or [str(current_user.tenant_id or "tenant_main")]
    return {
        "ok": True,
        "items": await manager.list_overview(tenant_ids),
    }


@app.get("/api/v1/escalations")
async def list_escalations_api(
    status: str = Query(default="pending_human_review"),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    from escalation_manager import list_escalations

    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "items": list_escalations(
            tenant_id=current_user.tenant_id,
            status=status or None,
            limit=limit,
        ),
    }


@app.post("/api/v1/escalations/{escalation_id}/resolve")
async def resolve_escalation_api(
    escalation_id: str,
    body: dict[str, Any],
    current_user: UserClaims = Depends(_decode_user),
):
    from escalation_manager import resolve_escalation

    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    result = resolve_escalation(
        escalation_id,
        resolution=str(body.get("resolution") or "skip"),
        note=str(body.get("note") or ""),
        resolved_by=str(body.get("resolved_by") or current_user.sub or "human"),
    )
    if not result:
        raise HTTPException(status_code=404, detail="escalation_not_found")
    return {"ok": True, "escalation": result}


@app.get("/api/v1/restore-events")
async def list_restore_events_api(
    limit: int = Query(default=20, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    from restore_event import list_restore_events

    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "events": list_restore_events(current_user.tenant_id, limit=limit),
    }

if Instrumentator is not None:
    Instrumentator().instrument(app).expose(app, endpoint="/metrics", include_in_schema=False)

app.include_router(
    fastapi_users.get_auth_router(auth_backend),
    prefix="/auth/jwt",
    tags=["auth"],
)
app.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["auth"],
)
app.include_router(
    fastapi_users.get_reset_password_router(),
    prefix="/auth",
    tags=["auth"],
)
app.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)


@app.middleware("http")
async def billing_subscription_middleware(request: Request, call_next):  # type: ignore[override]
    if not _billing_guard_enabled():
        return await call_next(request)

    guarded_paths = _billing_guarded_paths()
    path = request.url.path
    if path not in guarded_paths:
        return await call_next(request)

    claims = await _resolve_claims_from_auth_header(request.headers.get("authorization"))
    if claims is None:
        return await call_next(request)
    if "admin" in claims.roles:
        return await call_next(request)

    estimated_tokens = 0
    if path == "/run-dragon-team":
        estimated_tokens = int(os.getenv("BILLING_EST_TOKENS_RUN_DRAGON", "10000"))
    elif path == "/analyze_competitor_formula":
        estimated_tokens = int(os.getenv("BILLING_EST_TOKENS_ANALYZE_FORMULA", "4000"))
    elif path == "/receive_dm_from_edge":
        estimated_tokens = int(os.getenv("BILLING_EST_TOKENS_RECEIVE_DM", "1500"))

    decision = await evaluate_guard(
        user_id=claims.sub,
        tenant_id=claims.tenant_id,
        path=path,
        estimated_runs=1,
        estimated_tokens=max(0, estimated_tokens),
    )
    request.state.billing_guard = {
        "path": path,
        "allowed": decision.allowed,
        "code": decision.code,
        "reason": decision.reason,
        "subscription": decision.subscription,
    }
    if decision.allowed:
        return await call_next(request)

    if decision.code in {"run_quota_exceeded", "token_quota_exceeded"}:
        consume = edge_reward_consume_free_credits(
            user_id=claims.sub,
            tenant_id=claims.tenant_id,
            estimated_runs=1,
            estimated_tokens=max(0, estimated_tokens),
            note=f"billing_guard_fallback:{path}",
        )
        if consume.get("ok"):
            request.state.billing_guard = {
                "path": path,
                "allowed": True,
                "code": "allow_by_edge_rewards",
                "reason": "guard_fallback_by_free_credits",
                "subscription": decision.subscription,
                "edge_rewards": consume,
            }
            return await call_next(request)

    return JSONResponse(
        status_code=402,
        content={
            "detail": "Subscription guard blocked this request",
            "code": decision.code,
            "reason": decision.reason,
            "subscription": decision.subscription,
        },
    )


@app.middleware("http")
async def tenant_context_middleware(request: Request, call_next):  # type: ignore[override]
    tokens = None
    try:
        ctx = await resolve_optional_tenant_context(request)
        if ctx is not None:
            tokens = activate_tenant_context(ctx)
        return await call_next(request)
    finally:
        reset_tenant_context(tokens)


@app.get("/")
async def index():
    return {
        "service": "dragon-senate-saas-v3",
        "ok": True,
        "endpoints": {
            "healthz": "/healthz",
            "docs": "/docs",
            "login": "/auth/login",
            "jwt_login": "/auth/jwt/login",
            "register": "/auth/register",
            "billing_subscription_me": "/billing/subscription/me",
            "billing_plans": "/billing/plans",
            "billing_usage_summary": "/billing/usage/summary",
            "billing_usage_report": "/billing/usage/report",
            "billing_providers_status": "/billing/providers/status",
            "lobster_cost_summary": "/api/v1/cost/lobsters",
            "lobster_cost_detail": "/api/v1/cost/lobsters/{lobster_id}",
            "billing_checkout": "/billing/checkout",
            "billing_webhook": "/billing/webhook",
            "economy_status": "/economy/status",
            "economy_credit": "/economy/credit",
            "clawteam_queue": "/clawteam/queue",
            "clawteam_workers": "/clawteam/workers",
            "clawteam_worker_heartbeat": "/clawteam/worker/heartbeat",
            "clawteam_worker_claim": "/clawteam/worker/claim",
            "clawteam_worker_ack": "/clawteam/worker/ack",
            "clawteam_requeue_stale": "/clawteam/requeue-stale",
            "policy_bandit": "/policy/bandit",
            "industry_kb_profiles": "/industry-kb/profiles",
            "industry_kb_profile_upsert": "/industry-kb/profile",
            "industry_kb_generate_profile": "/industry-kb/generate-profile",
            "industry_kb_bulk_seed": "/industry-kb/bulk-seed",
            "industry_kb_ingest": "/industry-kb/ingest",
            "industry_kb_dissect_and_ingest": "/industry-kb/dissect-and-ingest",
            "industry_kb_search": "/industry-kb/search",
            "industry_kb_stats": "/industry-kb/stats",
            "industry_kb_metrics_dashboard": "/industry-kb/metrics/dashboard",
            "agent_rag_profiles": "/agent-rag/profiles",
            "agent_rag_catalog": "/agent-rag/catalog",
            "agent_rag_generate_pack": "/agent-rag/generate-pack",
            "agent_rag_packs": "/agent-rag/packs",
            "run": "/run-dragon-team",
            "analyze_formula": "/analyze_competitor_formula",
            "register_edge": "/edge/register",
            "edge_heartbeat": "/edge/heartbeat",
            "pull_edge_package": "/edge/pull/{edge_id}",
            "edge_consent_get": "/edge/consent/{edge_id}",
            "edge_consent_upsert": "/edge/consent/{edge_id}",
            "edge_consent_revoke": "/edge/consent/{edge_id}/revoke",
            "edge_lease_start": "/edge/lease/start",
            "edge_lease_end": "/edge/lease/end",
            "edge_lease_logs": "/edge/lease/logs",
            "edge_resource_summary": "/edge/resource/summary",
            "rewards_wallet": "/rewards/wallet",
            "rewards_claim": "/rewards/claim/free-pack",
            "rewards_claims": "/rewards/claims",
            "otp_request": "/otp/request",
            "otp_pending": "/otp/pending",
            "otp_submit": "/otp/submit",
            "otp_cancel": "/otp/cancel",
            "otp_consume": "/otp/consume",
            "receive_dm": "/receive_dm_from_edge",
            "followup_spawns_recent": "/followup/spawns/recent",
            "followup_spawn_by_trace": "/followup/spawns/{trace_id}",
            "chat_gateway": "/webhook/chat_gateway",
            "skills": "/api/skills",
            "skill_detail": "/api/skills/{skill_id}",
            "usecases": "/api/usecases",
            "usecase_detail": "/api/usecases/{usecase_id}",
            "usecase_categories": "/api/usecases/categories",
            "lobster_notifications": "/api/lobster/notifications",
            "lobster_foreground": "/api/lobster/foreground",
            "lobster_background_one": "/api/lobster/{run_id}/background",
            "lobster_background_all": "/api/lobster/background-all",
            "lobster_step_events": "/api/lobster/steps",
            "file_parse": "/api/v1/files/parse",
            "file_extract_business_card": "/api/v1/files/extract-business-card",
            "activities": "/api/v1/activities",
            "job_registry": "/api/v1/jobs/registry",
            "modules": "/api/v1/modules",
            "policies": "/api/v1/policies",
            "policy_evaluate": "/api/v1/policies/evaluate",
            "policy_bundle_current": "/api/v1/policies/bundle/current",
            "policy_decisions": "/api/v1/audit/decisions",
            "scheduler_tasks": "/api/scheduler/tasks",
            "scheduler_history": "/api/scheduler/tasks/{task_id}/history",
            "sessions": "/api/sessions",
            "session_history": "/api/sessions/{session_id}/history",
            "lobster_soul": "/api/lobster/{role_id}/soul",
            "lobster_agents": "/api/lobster/{role_id}/agents",
            "lobster_heartbeat": "/api/lobster/{role_id}/heartbeat",
            "lobster_working": "/api/lobster/{role_id}/working",
            "lobsters_registry": "/api/lobsters/registry",
            "heartbeat_status": "/api/heartbeat/status",
            "heartbeat_history": "/api/heartbeat/history",
            "llm_router_status": "/llm/router/status",
            "llm_router_smoke": "/llm/router/smoke",
            "channels_status": "/api/v1/channels/status",
            "channel_accounts": "/api/v1/channels/{channel}/accounts",
            "llm_model_catalog": "/llm/model/catalog",
            "llm_provider_configs": "/llm/providers",
            "llm_agent_bindings": "/llm/agent-bindings",
            "agent_extensions": "/agent/extensions",
            "agent_extension_detail": "/agent/extensions/{agent_id}",
            "skills_pool_overview": "/skills-pool/overview",
            "langsmith_status": "/observability/langsmith",
            "integrations_overview": "/integrations/overview",
            "integrations_libtv_status": "/integrations/libtv/status",
            "integrations_libtv_session": "/integrations/libtv/session/{session_id}",
            "integrations_feishu_test": "/integrations/feishu/test",
            "anythingllm_status": "/integrations/anythingllm/status",
            "anythingllm_embed": "/integrations/anythingllm/embed/snippet",
            "anythingllm_workspace_ensure": "/integrations/anythingllm/workspaces/ensure",
            "delivery_readiness": "/delivery/readiness",
            "hitl_pending": "/hitl/pending",
            "hitl_status": "/hitl/status/{approval_id}",
            "hitl_decide": "/hitl/decide",
            "metrics": "/metrics",
            "status": "/status/{user_id}",
            "run_dragon_team_async": "/run-dragon-team-async",
            "run_dragon_team_async_status": "/run-dragon-team-async/{job_id}",
            "memory_events": "/memory/events",
            "memory_trace": "/memory/trace/{trace_id}",
            "memory_replay": "/memory/replay/{trace_id}",
            "memory_wisdoms": "/api/memory/wisdoms",
            "memory_reports": "/api/memory/reports",
            "memory_stats": "/api/memory/stats",
            "memu_memory_stats": "/api/v1/memory/{tenant_id}/{lobster_id}/stats",
            "memu_memory_search": "/api/v1/memory/{tenant_id}/{lobster_id}/search",
            "memu_memory_category": "/api/v1/memory/{tenant_id}/{lobster_id}/{category}",
            "lead_conversion_status": "/api/v1/leads/{tenant_id}/{lead_id}/conversion-status",
            "lead_conversion_history": "/api/v1/leads/{tenant_id}/{lead_id}/conversion-history",
            "mind_map": "/api/v1/mind-map/{tenant_id}/{lead_id}",
            "mind_map_questions": "/api/v1/mind-map/{tenant_id}/{lead_id}/questions",
            "mind_map_briefing": "/api/v1/mind-map/{tenant_id}/{lead_id}/briefing",
            "graph_snapshot": "/api/v1/graph/{tenant_id}/snapshot",
            "graph_timeline": "/api/v1/graph/{tenant_id}/timeline",
            "memu_pending_tasks": "/api/v1/tasks/{tenant_id}/{lobster_id}/pending",
            "kernel_report": "/kernel/report/{trace_id}",
            "kernel_reports": "/kernel/reports",
            "kernel_rollout_policy": "/kernel/rollout/policy",
            "kernel_rollout_templates": "/kernel/rollout/templates",
            "kernel_rollout_templates_export": "/kernel/rollout/templates/export",
            "kernel_rollout_templates_import": "/kernel/rollout/templates/import",
            "kernel_rollout_template_rename": "/kernel/rollout/templates/{template_key}",
            "kernel_rollout_template_delete": "/kernel/rollout/templates/{template_key}",
            "kernel_metrics_dashboard": "/kernel/metrics/dashboard",
            "kernel_report_rollback": "/kernel/report/{trace_id}/rollback",
        },
    }


@app.get("/healthz")
async def healthz():
    return {
        "ok": True,
        "boot_id": app.state.app_boot_id,
        "checkpointer_mode": getattr(app.state, "checkpointer_mode", "unknown"),
        "redis_mode": getattr(app.state, "redis_mode", "unknown"),
        "langsmith": getattr(app.state, "langsmith", {"enabled": False}),
        "auth_bootstrap": getattr(app.state, "auth_bootstrap", {}),
        "billing_guard_enabled": _billing_guard_enabled(),
        "billing_guarded_paths": sorted(_billing_guarded_paths()),
        "economy": clawwork_status(),
        "notifications": auth_notification_status(),
    }


@app.get("/api/diagnostics/llm-log-stats")
async def get_llm_log_stats():
    from provider_registry import llm_log_stats

    return llm_log_stats()


@app.get("/api/diagnostics/finetune-readiness")
async def get_finetune_readiness():
    """Check if we have enough data for model fine-tuning."""
    from finetune_data_export import readiness_check

    return readiness_check()


@app.post("/api/diagnostics/finetune-export")
async def trigger_finetune_export(
    lobster_id: str | None = None,
    min_reward: float = 0.5,
    format: str = "sft",
):
    """Trigger a training data export."""
    from finetune_data_export import export_training_data

    return export_training_data(
        lobster_id=lobster_id,
        min_reward=min_reward,
        format=format,
    )


@app.get("/api/v1/channels/status")
async def channels_status():
    """返回所有渠道账号状态"""
    return channel_account_manager.describe()


@app.get("/api/v1/channels/{channel}/accounts")
async def channel_accounts(channel: str):
    """返回指定渠道的账号列表"""
    accs = channel_account_manager.get_accounts(channel)
    return {
        "channel": channel,
        "accounts": [
            {
                "id": a.account_id,
                "name": a.name,
                "enabled": a.enabled,
                "tenant": a.tenant_id,
                "options": dict(a.options),
            }
            for a in accs.values()
        ],
    }


class ChannelAccountOptionsUpdateRequest(BaseModel):
    dm_scope: str = Field(default="shared", pattern="^(shared|per-peer|isolated)$")
    group_respond_mode: str = Field(default="intent", pattern="^(always|intent|mention_only)$")
    thinking_placeholder_enabled: bool = True
    thinking_threshold_ms: int = Field(default=2500, ge=500, le=15000)


@app.put("/api/v1/channels/{channel}/accounts/{account_id}")
async def update_channel_account_options(
    channel: str,
    account_id: str,
    body: ChannelAccountOptionsUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
    _tenant_ctx: TenantContext = require_resource_permission(
        ResourceType.CHANNEL,
        ResourceScope.WRITE,
        resource_id_builder=lambda request: f"{request.path_params.get('channel')}:{request.path_params.get('account_id')}",
    ),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    updated = channel_account_manager.update_account_options(
        channel,
        account_id,
        {
            "dm_scope": body.dm_scope,
            "group_respond_mode": body.group_respond_mode,
            "thinking_placeholder_enabled": body.thinking_placeholder_enabled,
            "thinking_threshold_ms": body.thinking_threshold_ms,
        },
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="channel_account_not_found")
    return {
        "ok": True,
        "channel": channel,
        "account": {
            "id": updated.account_id,
            "name": updated.name,
            "enabled": updated.enabled,
            "tenant": updated.tenant_id,
            "options": dict(updated.options),
        },
    }


@app.get("/api/v1/heartbeat/active-check")
async def trigger_active_check(current_user: UserClaims = Depends(_decode_user)):
    checker = get_active_checker(current_user.tenant_id)
    issues = await checker.run_active_checks()
    return {"ok": True, "tenant_id": current_user.tenant_id, "issue_count": len(issues), "issues": issues}


@app.get("/api/v1/heartbeat/active-check/history")
async def trigger_active_check_history(current_user: UserClaims = Depends(_decode_user)):
    checker = get_active_checker(current_user.tenant_id)
    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "last_report": checker.latest_report(),
        "history": checker.history(),
    }


@app.post("/api/v1/security/dlp-alerts", dependencies=[Depends(_verify_edge_secret)])
async def report_dlp_alert_api(body: dict[str, Any]):
    alerts = list(getattr(app.state, "dlp_alerts", []) or [])
    alerts.insert(
        0,
        {
            "edge_node_id": body.get("edge_node_id"),
            "tenant_id": body.get("tenant_id"),
            "hit_count": body.get("hit_count", 0),
            "hits": body.get("hits", []),
            "detected_at": body.get("detected_at") or datetime.now(timezone.utc).isoformat(),
        },
    )
    app.state.dlp_alerts = alerts[:200]
    return {"ok": True}


@app.get("/api/v1/security/dlp-alerts")
async def list_dlp_alerts(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "tenant_id": current_user.tenant_id, "alerts": getattr(app.state, "dlp_alerts", [])}


@app.get("/api/v1/commander/suggested-intents")
async def get_suggested_intents(current_user: UserClaims = Depends(_decode_user)):
    from intent_predictor import retrieve_pending_intents
    from lobsters.followup import FollowUpLobster

    followup_lobster = FollowUpLobster()
    if hasattr(followup_lobster, "bind_runtime_context"):
        followup_lobster.bind_runtime_context(current_user.tenant_id)
    intents = await retrieve_pending_intents(followup_lobster)
    return {"ok": True, "tenant_id": current_user.tenant_id, "suggested_intents": intents}


@app.get("/api/skills")
@app.get("/api/v1/skills")
async def api_skills(
    lobster_id: str | None = Query(default=None),
    category: str | None = Query(default=None),
    enabled_only: bool = Query(default=True),
):
    """获取所有技能，或按龙虾过滤。"""
    registry = get_skill_registry()
    skills = registry.get_all()
    if lobster_id:
        normalized_lobster = str(lobster_id).strip()
        skills = [
            skill
            for skill in skills
            if not skill.bound_lobsters or normalized_lobster in skill.bound_lobsters
        ]
    if category:
        skills = [skill for skill in skills if str(skill.category or "") == str(category)]
    if enabled_only:
        skills = [skill for skill in skills if bool(skill.enabled)]
    return {
        "ok": True,
        "count": len(skills),
        "skills": [skill.to_api_dict() for skill in skills],
    }


@app.get("/api/skills/{skill_id}")
@app.get("/api/v1/skills/{skill_id}")
async def api_skill_detail(skill_id: str):
    """获取单个技能详情。"""
    registry = get_skill_registry()
    skill = registry.get(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill_not_found")
    return {"ok": True, "skill": skill.to_api_dict()}


@app.get("/api/skills/{skill_id}/effectiveness")
async def api_skill_effectiveness(skill_id: str):
    """获取技能效力评级。"""
    registry = get_skill_registry()
    skill = registry.get(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill_not_found")
    return {"ok": True, "skill_id": skill_id, "effectiveness": skill.effectiveness.to_dict()}


@app.patch("/api/v1/skills/{skill_id}/status")
async def api_skill_status_patch(
    skill_id: str,
    body: SkillStatusPatchRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    registry = get_skill_registry()
    skill = registry.get(skill_id)
    if skill is None:
        raise HTTPException(status_code=404, detail="skill_not_found")

    target_status = str(body.status or "").strip().lower()
    if target_status not in {"draft", "review", "approved", "deprecated"}:
        raise HTTPException(status_code=400, detail="invalid_skill_status")
    if target_status == "approved" and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")

    manifest = load_skill_manifest(skill.bound_lobsters[0] if skill.bound_lobsters else "")
    scan_status = getattr(skill, "scan_status", "not_scanned")
    scan_report: dict[str, Any] = dict(getattr(skill, "scan_report", {}) or {})

    if target_status == "approved":
        if manifest is None:
            raise HTTPException(status_code=400, detail="skill_manifest_not_found")
        system_prompt, user_template = load_prompt_assets_for_manifest(manifest)
        scan_result = await scan_skill_content(skill.bound_lobsters[0] if skill.bound_lobsters else "", system_prompt, user_template)
        scan_status = str(scan_result.risk_level)
        scan_report = scan_result.model_dump()
        update_skill_manifest(
            manifest.lobster_id,
            {
                "scan_status": scan_status,
                "scan_report": scan_report,
            },
        )
        if scan_result.risk_level == "block":
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "skill_scan_blocked",
                    "issues": scan_result.issues,
                    "confidence": scan_result.confidence,
                },
            )

    ok = registry.update_publish_status(
        skill_id,
        target_status,
        note=str(body.note or "").strip(),
        updated_by=current_user.sub,
        scan_status=scan_status,
        scan_report=scan_report if scan_report else None,
    )
    if not ok:
        raise HTTPException(status_code=404, detail="skill_not_found")

    await get_audit_service().log(
        AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="skill",
        resource_id=skill_id,
        details={
            "publish_status": target_status,
            "note": str(body.note or "").strip(),
            "scan_status": scan_status,
        },
    )
    return {"ok": True, "skill_id": skill_id, "status": target_status, "scan_status": scan_status, "scan_report": scan_report}


@app.post("/api/v1/skills/register")
async def api_skill_register(
    body: SkillRegisterRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")

    manifest = dict(body.manifest or {})
    policy = SkillPublishPolicy()
    violations = policy.validate(
        manifest,
        [str(item or "").strip() for item in body.files if str(item or "").strip()],
        system_prompt=str(body.system_prompt or ""),
        user_template=str(body.user_template or ""),
    )
    if violations:
        await get_audit_service().log(
            AuditEventType.SYSTEM_CONFIG_UPDATE,
            tenant_id=current_user.tenant_id,
            user_id=current_user.sub,
            resource_type="skill_manifest",
            resource_id=str(manifest.get("id") or manifest.get("lobster_id") or ""),
            details={"violations": violations, "manifest": manifest},
            severity="WARNING",
        )
        raise HTTPException(status_code=422, detail={"violations": violations})

    persisted = None
    if body.persist:
        lobster_id = str(manifest.get("lobster_id") or "").strip()
        if not lobster_id:
            raise HTTPException(status_code=422, detail={"violations": ["required field 'lobster_id' missing"]})
        persisted = update_skill_manifest(lobster_id, manifest)

    return {
        "ok": True,
        "validated": True,
        "persisted": bool(body.persist and persisted is not None),
        "manifest": persisted.to_dict() if persisted is not None else manifest,
    }


@app.put("/api/skills/{skill_id}/config")
async def api_skill_config_update(skill_id: str, body: dict):
    """更新技能配置。"""
    registry = get_skill_registry()
    ok = registry.configure(skill_id, body.get("config", {}))
    if not ok:
        raise HTTPException(status_code=404, detail="skill_not_found")
    return {"ok": True, "skill_id": skill_id}


@app.put("/api/skills/{skill_id}/enable")
async def api_skill_enable(skill_id: str):
    """启用技能。"""
    registry = get_skill_registry()
    ok = registry.enable(skill_id)
    if not ok:
        raise HTTPException(status_code=404, detail="skill_not_found")
    return {"ok": True, "skill_id": skill_id, "enabled": True}


@app.put("/api/skills/{skill_id}/disable")
async def api_skill_disable(skill_id: str):
    """禁用技能。"""
    registry = get_skill_registry()
    ok = registry.disable(skill_id)
    if not ok:
        raise HTTPException(status_code=404, detail="skill_not_found")
    return {"ok": True, "skill_id": skill_id, "enabled": False}


@app.get("/api/skills/recommended")
async def api_skills_recommended(
    lobster_id: str = Query(...),
    industry: str | None = Query(default=None),
    channel: str | None = Query(default=None),
    top_n: int = Query(default=5, le=20),
):
    """获取推荐技能列表（按效力评级排序）。"""
    from skill_effectiveness_calibrator import get_calibrator
    recommendations = get_calibrator().get_recommended_skills(
        lobster_id=lobster_id, industry=industry, channel=channel, top_n=top_n
    )
    return {"ok": True, "lobster_id": lobster_id, "recommendations": recommendations}


@app.post("/api/skills/calibrate")
async def api_skills_calibrate(current_user: UserClaims = Depends(_decode_user)):
    """触发技能效力评级重新校准。"""
    from skill_effectiveness_calibrator import get_calibrator
    result = get_calibrator().calibrate_from_pool_manager()
    return {"ok": True, **result}


@app.post("/api/v1/skills/calibrate")
async def api_v1_skills_calibrate(
    reward_history: list[dict[str, Any]] = Body(default_factory=list),
    current_user: UserClaims = Depends(_decode_user),
):
    """兼容 v1 路由，支持直接传 reward_history 或回退到池管理器历史。"""
    from skill_effectiveness_calibrator import get_calibrator

    calibrator = get_calibrator()
    history = [item for item in reward_history if isinstance(item, dict)]
    if history:
        result = calibrator.calibrate_from_rewards(history)
    else:
        result = calibrator.calibrate_from_pool_manager()
    return {"ok": True, **result}


@app.post("/api/onboarding/complete")
@app.post("/api/v1/onboarding/complete")
async def api_onboarding_complete(
    body: dict[str, Any] = Body(...),
    current_user: UserClaims = Depends(_decode_user),
):
    from enterprise_onboarding import EnterpriseOnboardingPipeline

    payload = dict(body or {})
    target_tenant = str(payload.get("tenant_id") or current_user.tenant_id or "").strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id_required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")

    payload["tenant_id"] = target_tenant
    if not payload.get("enterprise_name"):
        payload["enterprise_name"] = str(payload.get("brand_name") or "").strip()
    if not payload.get("industry_l1"):
        payload["industry_l1"] = str(payload.get("industry_category") or "").strip()
    if not payload.get("industry_l2"):
        payload["industry_l2"] = str(payload.get("industry_sub") or "").strip()
    if not payload.get("enterprise_name"):
        raise HTTPException(status_code=400, detail="enterprise_name_required")

    pipeline = EnterpriseOnboardingPipeline()
    result = pipeline.run_onboarding(payload)
    return {"ok": True, **result}


@app.get("/api/strategy/intensity")
async def api_strategy_intensity(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = tenant_id or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    return {
        "ok": True,
        **get_strategy_intensity_snapshot(target_tenant),
    }


@app.get("/api/strategy/intensity/history")
async def api_strategy_intensity_history(
    tenant_id: str | None = Query(default=None),
    lobster_id: str | None = Query(default=None),
    days: int = Query(default=7, ge=1, le=365),
    limit: int = Query(default=200, ge=1, le=1000),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = tenant_id or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    manager = get_strategy_intensity_manager(target_tenant)
    items = manager.get_history(
        lobster_id=str(lobster_id or "").strip() or None,
        days=days,
        limit=limit,
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "count": len(items),
        "items": items,
    }


@app.post("/api/strategy/intensity/escalate")
async def api_strategy_intensity_escalate(
    body: StrategyIntensityMutationRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = body.tenant_id or current_user.tenant_id
    manager = get_strategy_intensity_manager(target_tenant)
    changed = manager.escalate(
        manual=True,
        updated_by=current_user.sub,
        reason=str(body.reason or "manual_escalate").strip(),
        lobster_id=str(body.lobster_id or "").strip() or None,
    )
    if not changed:
        raise HTTPException(status_code=409, detail=manager.last_transition_error or "strategy_intensity_escalate_failed")
    snapshot = manager.get_snapshot()
    return {
        "ok": True,
        "changed": True,
        **snapshot,
    }


@app.post("/api/strategy/intensity/deescalate")
async def api_strategy_intensity_deescalate(
    body: StrategyIntensityMutationRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = body.tenant_id or current_user.tenant_id
    manager = get_strategy_intensity_manager(target_tenant)
    changed = manager.deescalate(
        updated_by=current_user.sub,
        reason=str(body.reason or "manual_deescalate").strip(),
        lobster_id=str(body.lobster_id or "").strip() or None,
    )
    if not changed:
        raise HTTPException(status_code=409, detail=manager.last_transition_error or "strategy_intensity_deescalate_failed")
    snapshot = manager.get_snapshot()
    return {
        "ok": True,
        "changed": True,
        **snapshot,
    }


@app.get("/api/autonomy/policy")
async def api_autonomy_policy(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = tenant_id or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    return {
        "ok": True,
        **get_autonomy_policy_manager().get_snapshot(target_tenant),
    }


@app.put("/api/autonomy/policy")
async def api_autonomy_policy_update(
    body: AutonomyPolicyUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = body.tenant_id or current_user.tenant_id
    return {
        "ok": True,
        **get_autonomy_policy_manager().update_policy(
            target_tenant,
            default_level=body.default_level,
            per_lobster_overrides=body.per_lobster_overrides,
            updated_by=current_user.sub,
            reason=str(body.reason or "").strip(),
        ),
    }


@app.get("/api/lobster/{role_id}/soul")
async def api_lobster_soul(role_id: str):
    """返回 SOUL.md 内容。"""
    return {"ok": True, "role_id": role_id, "content": load_soul(role_id)}


@app.get("/api/lobster/{role_id}/agents")
async def api_lobster_agents(role_id: str):
    """返回 AGENTS.md 内容。"""
    return {"ok": True, "role_id": role_id, "content": load_agents_rules(role_id)}


@app.get("/api/lobster/{role_id}/heartbeat")
async def api_lobster_heartbeat(role_id: str):
    """返回 heartbeat.json 内容。"""
    return {"ok": True, "role_id": role_id, "heartbeat": load_heartbeat(role_id)}


@app.get("/api/lobster/{role_id}/working")
async def api_lobster_working(role_id: str):
    """返回 working.json 内容。"""
    return {"ok": True, "role_id": role_id, "working": load_working(role_id)}


@app.get("/api/lobsters/registry")
async def api_lobsters_registry():
    """返回龙虾注册表摘要。"""
    items = get_lobster_summary()
    return {"ok": True, "count": len(items), "items": items}


@app.get("/api/v1/lobsters")
async def api_v1_lobsters(
    lifecycle: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    rows = get_lifecycle_manager().list_lobsters(lifecycle=lifecycle)
    return {"ok": True, "count": len(rows), "items": rows}


@app.get("/api/v1/lobsters/runs")
async def api_v1_lobster_runs_all(
    lobster_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_pool_manager import list_lobster_runs_paginated

    payload = list_lobster_runs_paginated(
        tenant_id=current_user.tenant_id,
        lobster_id=lobster_id,
        status=status,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    response = PaginatedResponse.from_items(
        payload["items"],
        total=payload["total"],
        page=payload["page"],
        page_size=payload["page_size"],
    )
    return {"ok": True, "tenant_id": current_user.tenant_id, **response.to_dict()}


@app.get("/api/v1/lobsters/{lobster_id}")
async def api_v1_lobster_detail(
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_pool_manager import lobster_detail

    detail = lobster_detail(lobster_id, tenant_id=current_user.tenant_id, limit=20)
    lifecycle = get_lifecycle_manager().get_lobster(lobster_id)
    if not detail.get("ok"):
        raise HTTPException(status_code=404, detail="lobster_not_found")
    detail["lobster"].update({
        "lifecycle": lifecycle.get("lifecycle", "production") if lifecycle else "production",
        "system": lifecycle.get("system", "follow-growth") if lifecycle else "follow-growth",
        "annotations": lifecycle.get("annotations", {}) if lifecycle else {},
        "description": lifecycle.get("description", detail["lobster"].get("role", "")) if lifecycle else detail["lobster"].get("role", ""),
    })
    return detail


@app.get("/api/v1/lobsters/{lobster_id}/stats")
async def api_v1_lobster_stats(
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_pool_manager import lobster_detail

    detail = lobster_detail(lobster_id, tenant_id=current_user.tenant_id, limit=10)
    if not detail.get("ok"):
        raise HTTPException(status_code=404, detail="lobster_not_found")
    lobster = detail["lobster"]
    return {
        "ok": True,
        "stats": {
            "weekly_runs": int(lobster.get("run_count_24h", 0) or 0),
            "avg_quality_score": float(lobster.get("score", 0) or 0),
            "p95_latency_ms": float(lobster.get("avg_latency_ms", 0) or 0),
            "active_edge_nodes": 0,
        },
    }


@app.get("/api/v1/lobsters/{lobster_id}/runs")
async def api_v1_lobster_runs(
    lobster_id: str,
    limit: int = Query(default=20, ge=1, le=100),
    page: int = Query(default=1, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=200),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_pool_manager import list_lobster_runs_paginated

    payload = list_lobster_runs_paginated(
        tenant_id=current_user.tenant_id,
        lobster_id=lobster_id,
        page=page,
        page_size=page_size or limit,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    response = PaginatedResponse.from_items(
        payload["items"],
        total=payload["total"],
        page=payload["page"],
        page_size=payload["page_size"],
    )
    return {"ok": True, "lobster_id": lobster_id, **response.to_dict()}


@app.get("/api/v1/lobsters/{lobster_id}/skills")
async def api_v1_lobster_skills(
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    registry = get_skill_registry()
    return {"ok": True, "items": registry.to_api_list(lobster_id)}


@app.get("/api/v1/lobsters/{lobster_id}/docs")
async def api_v1_lobster_docs(
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_doc_store import get_lobster_doc_store

    latest = get_lobster_doc_store().get_latest_for_lobster(lobster_id, current_user.tenant_id)
    if latest:
        return {
            "ok": True,
            "lobster_id": lobster_id,
            "content": latest.get("content"),
            "path": f"docstore:{latest.get('doc_id')}",
            "doc_id": latest.get("doc_id"),
            "title": latest.get("title"),
            "version": latest.get("version"),
        }
    docs_root = Path(__file__).resolve().parent.parent / "docs" / "lobster-kb"
    candidates = sorted(docs_root.glob(f"{lobster_id}-*.md"))
    if not candidates:
        raise HTTPException(status_code=404, detail="lobster_docs_not_found")
    return {
        "ok": True,
        "lobster_id": lobster_id,
        "content": candidates[0].read_text(encoding="utf-8"),
        "path": str(candidates[0]),
    }


@app.get("/api/v1/lobster-config")
async def api_v1_lobster_config_list(current_user: UserClaims = Depends(_decode_user)):
    from lobster_config_center import get_lobster_config_center

    center = get_lobster_config_center()
    items = center.list_all_lobsters(current_user.tenant_id)
    return {"ok": True, "tenant_id": current_user.tenant_id, "items": items, "count": len(items)}


@app.get("/api/v1/lobster-config/{lobster_id}")
async def api_v1_lobster_config_detail(
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_config_center import get_lobster_config_center

    try:
        payload = get_lobster_config_center().get_lobster_config(lobster_id, current_user.tenant_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="lobster_not_found") from exc
    return {"ok": True, **payload}


@app.patch("/api/v1/lobster-config/{lobster_id}")
async def api_v1_lobster_config_update(
    lobster_id: str,
    body: LobsterConfigUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from lobster_config_center import get_lobster_config_center

    try:
        return get_lobster_config_center().update_lobster_config(
            lobster_id,
            current_user.tenant_id,
            {
                key: value
                for key, value in body.model_dump().items()
                if value is not None
            },
            updated_by=current_user.sub,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="lobster_not_found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/v1/lobsters/{lobster_id}/lifecycle")
async def api_v1_lobster_lifecycle(
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    lobster = get_lifecycle_manager().get_lobster(lobster_id)
    if lobster is None:
        raise HTTPException(status_code=404, detail="lobster_not_found")
    return {"ok": True, "lobster_id": lobster_id, "lifecycle": lobster.get("lifecycle", "production")}


@app.put("/api/v1/lobsters/{lobster_id}/lifecycle")
async def api_v1_lobster_lifecycle_update(
    lobster_id: str,
    body: LifecycleChangeRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    try:
        event = await get_lifecycle_manager().change_lobster_lifecycle(
            lobster_id,
            LobsterLifecycle(body.new_lifecycle),
            changed_by=current_user.sub,
            tenant_id=current_user.tenant_id,
            reason=body.reason,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="lobster_not_found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "event": event.__dict__}


@app.get("/api/v1/lobsters/{lobster_id}/quality-stats")
async def api_v1_lobster_quality_stats(
    lobster_id: str,
    days: int = Query(default=30, ge=1, le=365),
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_feedback_collector import get_lobster_feedback_collector

    stats = get_lobster_feedback_collector().quality_stats(lobster_id, current_user.tenant_id, days=days)
    return {"ok": True, "stats": stats}


@app.post("/api/v1/feedbacks")
async def api_submit_feedback(
    body: FeedbackSubmitRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_feedback_collector import LobsterFeedback, get_lobster_feedback_collector

    collector = get_lobster_feedback_collector()
    result = await collector.submit(
        LobsterFeedback(
            task_id=body.task_id,
            lobster_id=body.lobster_id,
            tenant_id=current_user.tenant_id,
            user_id=current_user.sub,
            rating=body.rating,
            tags=[str(item) for item in body.tags if str(item).strip()],
            comment=str(body.comment or "").strip(),
            revised_output=str(body.revised_output or "").strip(),
            input_prompt=str(body.input_prompt or "").strip(),
            original_output=str(body.original_output or "").strip(),
        )
    )
    return {"ok": True, **result}


@app.get("/api/v1/feedbacks/{task_id}")
async def api_list_feedbacks_for_task(
    task_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_feedback_collector import get_lobster_feedback_collector

    items = get_lobster_feedback_collector().list_for_task(task_id, current_user.tenant_id)
    return {"ok": True, "task_id": task_id, "items": items, "count": len(items)}


@app.get("/api/v1/feedbacks/export")
async def api_export_feedback_dataset(
    lobster_id: str = Query(..., min_length=1, max_length=64),
    limit: int = Query(default=200, ge=1, le=1000),
    current_user: UserClaims = Depends(_decode_user),
):
    from lobster_feedback_collector import get_lobster_feedback_collector

    return {
        "ok": True,
        **get_lobster_feedback_collector().export_dataset(lobster_id, current_user.tenant_id, limit=limit),
    }


@app.get("/api/heartbeat/status")
async def api_heartbeat_status(current_user: UserClaims = Depends(_decode_user)):
    """返回最新心跳报告。"""
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    engine = getattr(app.state, "heartbeat_engine", get_heartbeat_engine())
    latest = engine.latest_report()
    if latest is None:
        latest = await engine.run_heartbeat()
    return {"ok": True, "report": latest}


@app.get("/api/heartbeat/history")
async def api_heartbeat_history(current_user: UserClaims = Depends(_decode_user)):
    """返回历史心跳报告列表。"""
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    engine = getattr(app.state, "heartbeat_engine", get_heartbeat_engine())
    return {"ok": True, "count": len(engine.history()), "items": engine.history()}


@app.get("/notifications/status")
async def notifications_status(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "notifications": auth_notification_status()}


@app.get("/notifications/outbox")
async def notifications_outbox(
    limit: int = Query(default=20, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    items = list_recent_notifications(limit=limit)
    return {"ok": True, "count": len(items), "items": items}


@app.post("/notifications/test")
async def notifications_test(
    body: NotificationTestRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    result = send_test_notification(target=body.target, text=body.text)
    return {"ok": result.ok, "result": result.as_dict()}


@app.get("/llm/router/status")
async def llm_router_status(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "router": llm_router.describe()}


@app.get("/api/v1/providers/health")
async def provider_health_status(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {
        "ok": True,
        "providers": provider_health_report(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/api/v1/bootstrap/{session_id}/{lobster_id}")
async def bootstrap_status_api(
    session_id: str,
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    session = get_session_manager().get_session(session_id)
    if session is not None:
        tenant_id = str(getattr(session, "tenant_id", "") or "").strip()
        if tenant_id and tenant_id != current_user.tenant_id and "admin" not in current_user.roles:
            raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    payload = get_bootstrap_status_payload(lobster_id, session_id)
    return {"ok": True, **payload}


@app.post("/api/v1/bootstrap/{session_id}/{lobster_id}/reset")
async def bootstrap_reset_api(
    session_id: str,
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    session = get_session_manager().get_session(session_id)
    if session is not None:
        tenant_id = str(getattr(session, "tenant_id", "") or "").strip()
        if tenant_id and tenant_id != current_user.tenant_id and "admin" not in current_user.roles:
            raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    reset = await reset_lobster_bootstrap(lobster_id, session_id)
    return {"ok": True, "session_id": session_id, "lobster_id": lobster_id, "reset": reset}


@app.get("/api/v1/feature-flags")
async def list_feature_flags_api(
    environment: str | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    flags = [flag.to_dict() for flag in get_feature_flag_client().list_flags(environment=environment, tenant_id=tenant_id or current_user.tenant_id)]
    return {"ok": True, "flags": flags}


@app.post("/api/v1/feature-flags")
async def create_feature_flag_api(
    body: FeatureFlagCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    flag = _to_flag(body, name=body.name, created_by=current_user.sub)
    saved = get_feature_flag_client().upsert_flag(flag, changed_by=current_user.sub)
    await _broadcast_feature_flag_event("FLAG_CREATED", saved)
    return {"ok": True, "flag": saved.to_dict()}

@app.post("/api/v1/feature-flags/check")
async def check_feature_flag_api(
    body: FeatureFlagCheckRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, **get_feature_flag_client().check(body.flag_name, _flag_check_ctx(body))}


@app.get("/api/v1/feature-flags/changelog")
async def feature_flag_changelog_api(
    name: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "items": get_feature_flag_client().list_changelog(limit=limit, name=name)}


@app.post("/api/v1/feature-flags/export")
async def export_feature_flags_api(
    environment: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, **get_feature_flag_client().export_snapshot(environment=environment)}


@app.post("/api/v1/feature-flags/import")
async def import_feature_flags_api(
    body: FeatureFlagImportRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    count = get_feature_flag_client().import_snapshot({"flags": body.flags}, changed_by=current_user.sub)
    return {"ok": True, "imported": count}


@app.get("/api/v1/feature-flags/edge")
async def edge_feature_flags_api(
    node_id: str = Query(default=""),
    tags: str = Query(default=""),
):
    node_tags = [item.strip() for item in tags.split(",") if item.strip()]
    flags = [
        flag.to_dict()
        for flag in get_feature_flag_client().list_flags(environment="prod")
        if _edge_flag_applicable(flag, node_tags)
    ]
    return {"ok": True, "node_id": node_id, "tags": node_tags, "flags": flags}


@app.websocket("/api/v1/feature-flags/ws")
async def feature_flags_ws(websocket: WebSocket):
    await websocket.accept()
    clients: set[WebSocket] = getattr(app.state, "feature_flag_ws_clients", set())
    clients.add(websocket)
    app.state.feature_flag_ws_clients = clients
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        clients.discard(websocket)
    except Exception:
        clients.discard(websocket)


# ──────────────────────────────────────────────────────────────────────
# WebSocket: /ws/execution-logs  — 实时执行日志推送
# 前端 /operations/monitor 页面订阅，实时推送龙虾步骤执行事件
# ──────────────────────────────────────────────────────────────────────

def _get_execution_log_clients() -> set[WebSocket]:
    """获取或初始化执行日志 WS 客户端集合。"""
    if not hasattr(app.state, "execution_log_ws_clients"):
        app.state.execution_log_ws_clients = set()
    return app.state.execution_log_ws_clients


async def _broadcast_execution_log(event: dict) -> None:
    """广播执行日志事件到所有订阅的 WS 客户端。"""
    clients = _get_execution_log_clients()
    if not clients:
        return
    payload = json.dumps(event, ensure_ascii=False, default=str)
    stale: list[WebSocket] = []
    for ws in list(clients):
        try:
            await ws.send_text(payload)
        except Exception:
            stale.append(ws)
    for ws in stale:
        clients.discard(ws)


@app.websocket("/ws/execution-logs")
async def execution_logs_ws(websocket: WebSocket):
    """
    实时执行日志 WebSocket 端点。

    前端连接后，每次龙虾执行步骤时会收到推送事件：
        {
            "type": "step_event",
            "lobster_id": "radar",
            "task_id": "...",
            "action": "scan_trends",
            "status": "started" | "done" | "error",
            "reward_score": 0.85,
            "ts": 1712345678.0
        }
    """
    await websocket.accept()
    clients = _get_execution_log_clients()
    clients.add(websocket)
    # 发送欢迎帧
    try:
        await websocket.send_text(json.dumps({"type": "connected", "ts": time.time()}, ensure_ascii=False))
        while True:
            await websocket.receive_text()  # 保持连接，忽略客户端消息
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        clients.discard(websocket)


# ──────────────────────────────────────────────────────────────────────
# REST: /operations/monitor  — 运营监控快照
# 返回当前所有龙虾状态、边缘节点状态、执行日志连接数
# ──────────────────────────────────────────────────────────────────────

@app.get("/api/v1/operations/monitor")
async def operations_monitor(
    current_user: UserClaims = Depends(_decode_user),
) -> dict:
    """运营监控快照接口 — 供前端 /operations/monitor 页面轮询。"""
    from lobster_pool_manager import get_all_lobster_health
    try:
        health_rows = get_all_lobster_health()
    except Exception:
        health_rows = []

    execution_ws_count = len(_get_execution_log_clients())

    edge_nodes: list[dict] = []
    try:
        edge_registry = getattr(app.state, "edge_node_registry", {})
        edge_nodes = [
            {
                "edge_id": eid,
                "status": row.get("status", "unknown"),
                "last_seen": row.get("last_seen_ts"),
                "tenant_id": row.get("tenant_id", ""),
                "capabilities": row.get("skills", []),
            }
            for eid, row in edge_registry.items()
        ]
    except Exception:
        edge_nodes = []

    return {
        "ok": True,
        "lobsters": health_rows,
        "edge_nodes": edge_nodes,
        "execution_ws_subscribers": execution_ws_count,
        "ts": time.time(),
    }


@app.get("/api/v1/feature-flags/{name}")
async def get_feature_flag_api(
    name: str,
    environment: str = Query(default="prod"),
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    flag = get_feature_flag_client().get_flag(name, environment=environment, tenant_id=tenant_id or current_user.tenant_id)
    if flag is None:
        raise HTTPException(status_code=404, detail="feature_flag_not_found")
    return {"ok": True, "flag": flag.to_dict()}


@app.put("/api/v1/feature-flags/{name}")
async def update_feature_flag_api(
    name: str,
    body: FeatureFlagUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    existing = get_feature_flag_client().get_flag(name, environment=body.environment or "prod", tenant_id=body.tenant_id or current_user.tenant_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="feature_flag_not_found")
    saved = get_feature_flag_client().upsert_flag(_to_flag(body, name=name, created_by=current_user.sub, existing=existing), changed_by=current_user.sub)
    await _broadcast_feature_flag_event("FLAG_UPDATED", saved)
    return {"ok": True, "flag": saved.to_dict()}


@app.delete("/api/v1/feature-flags/{name}")
async def delete_feature_flag_api(
    name: str,
    environment: str = Query(default="prod"),
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    try:
        deleted = get_feature_flag_client().delete_flag(name, environment=environment, tenant_id=tenant_id or current_user.tenant_id, changed_by=current_user.sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "deleted": deleted}


@app.post("/api/v1/feature-flags/{name}/enable")
async def enable_feature_flag_api(
    name: str,
    environment: str = Query(default="prod"),
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    saved = get_feature_flag_client().set_enabled(name, True, environment=environment, tenant_id=tenant_id or current_user.tenant_id, changed_by=current_user.sub)
    if saved is None:
        raise HTTPException(status_code=404, detail="feature_flag_not_found")
    await _broadcast_feature_flag_event("FLAG_UPDATED", saved)
    return {"ok": True, "flag": saved.to_dict()}


@app.post("/api/v1/feature-flags/{name}/disable")
async def disable_feature_flag_api(
    name: str,
    environment: str = Query(default="prod"),
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    saved = get_feature_flag_client().set_enabled(name, False, environment=environment, tenant_id=tenant_id or current_user.tenant_id, changed_by=current_user.sub)
    if saved is None:
        raise HTTPException(status_code=404, detail="feature_flag_not_found")
    await _broadcast_feature_flag_event("FLAG_UPDATED", saved)
    return {"ok": True, "flag": saved.to_dict()}


@app.post("/api/v1/feature-flags/{name}/strategies")
async def update_feature_flag_strategies_api(
    name: str,
    body: FeatureFlagUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    strategies = [FlagStrategy(type=StrategyType(item.type), parameters=dict(item.parameters or {})) for item in (body.strategies or [])]
    saved = get_feature_flag_client().update_strategies(name, strategies, environment=body.environment or "prod", tenant_id=body.tenant_id or current_user.tenant_id, changed_by=current_user.sub)
    if saved is None:
        raise HTTPException(status_code=404, detail="feature_flag_not_found")
    await _broadcast_feature_flag_event("FLAG_UPDATED", saved)
    return {"ok": True, "flag": saved.to_dict()}


@app.post("/api/v1/feature-flags/{name}/variants")
async def update_feature_flag_variants_api(
    name: str,
    body: FeatureFlagUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    variants = [FlagVariant(name=item.name, weight=item.weight, payload=item.payload, enabled=item.enabled) for item in (body.variants or [])]
    try:
        saved = get_feature_flag_client().update_variants(name, variants, environment=body.environment or "prod", tenant_id=body.tenant_id or current_user.tenant_id, changed_by=current_user.sub)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if saved is None:
        raise HTTPException(status_code=404, detail="feature_flag_not_found")
    await _broadcast_feature_flag_event("FLAG_UPDATED", saved)
    return {"ok": True, "flag": saved.to_dict()}


@app.get("/api/v1/prompt-experiments")
async def list_prompt_experiments_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from prompt_registry import get_prompt_registry

    return {"ok": True, "items": get_prompt_registry().list_prompt_experiments()}


@app.post("/api/v1/prompt-experiments")
async def create_prompt_experiment_api(
    body: PromptExperimentCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from prompt_registry import get_prompt_registry

    prompt_path = Path(__file__).resolve().parent / "prompts" / body.lobster_name / f"{body.skill_name}_{body.experiment_variant}.md"
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text(body.prompt_text, encoding="utf-8")
    flag_name = f"prompt.{body.lobster_name}.{body.skill_name}.experiment"
    flag = FeatureFlag(
        name=flag_name,
        enabled=True,
        environment=_flag_env(body.environment),
        strategies=[FlagStrategy(type=StrategyType.GRADUAL_ROLLOUT, parameters={"rollout": body.rollout_percent, "stickiness": "tenant_id"})],
        variants=[FlagVariant(name=body.experiment_variant, weight=1000, payload=body.experiment_variant, enabled=True)],
        description=f"Prompt AB test for {body.lobster_name}.{body.skill_name}",
        tags=["prompt", "experiment", body.lobster_name],
        created_by=current_user.sub,
    )
    saved = get_feature_flag_client().upsert_flag(flag, changed_by=current_user.sub)
    await _broadcast_feature_flag_event("FLAG_CREATED", saved)
    return {"ok": True, "flag": saved.to_dict(), "prompt_path": str(prompt_path)}


@app.get("/api/v1/prompt-experiments/{flag_name}/report")
async def prompt_experiment_report_api(flag_name: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from prompt_registry import get_prompt_registry

    return {"ok": True, "report": get_prompt_registry().get_experiment_report(flag_name)}


@app.post("/api/v1/prompt-experiments/{flag_name}/promote")
async def prompt_experiment_promote_api(
    flag_name: str,
    body: PromptExperimentPromoteRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from prompt_registry import get_prompt_registry

    result = get_prompt_registry().promote_experiment(flag_name, body.winner_variant, changed_by=current_user.sub)
    return {"ok": True, "result": result}


@app.post("/api/v1/prompt-experiments/{flag_name}/stop")
async def prompt_experiment_stop_api(flag_name: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    parts = flag_name.split(".")
    environment = "prod"
    tenant_id = current_user.tenant_id
    saved = get_feature_flag_client().set_enabled(flag_name, False, environment=environment, tenant_id=tenant_id, changed_by=current_user.sub)
    if saved is None:
        saved = get_feature_flag_client().set_enabled(flag_name, False, environment=environment, tenant_id=None, changed_by=current_user.sub)
    if saved is None:
        raise HTTPException(status_code=404, detail="prompt_experiment_not_found")
    await _broadcast_feature_flag_event("FLAG_UPDATED", saved)
    return {"ok": True, "flag": saved.to_dict()}


async def _run_experiment_eval_background(experiment_id: str, concurrency: int | None = None) -> None:
    from experiment_registry import get_experiment_registry
    from experiment_registry import run_experiment_evaluation

    registry = get_experiment_registry()
    try:
        await run_experiment_evaluation(experiment_id, registry=registry, concurrency=concurrency)
    except Exception as exc:
        logger.warning("[ExperimentEval] background run failed for %s: %s", experiment_id, exc)
        registry.update_status(experiment_id, "failed", completed=True)


@app.get("/api/v1/experiments/compare")
async def compare_experiments_api(
    a: str,
    b: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from experiment_registry import get_experiment_registry

    registry = get_experiment_registry()
    left = registry.get_experiment(a)
    right = registry.get_experiment(b)
    if not left or not right:
        raise HTTPException(status_code=404, detail="experiment_not_found")
    if str(left.get("tenant_id") or "") != current_user.tenant_id or str(right.get("tenant_id") or "") != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    result = registry.compare(a, b)
    if result.get("error") == "experiment_not_found":
        raise HTTPException(status_code=404, detail="experiment_not_found")
    return {"ok": True, "comparison": result}


@app.get("/api/v1/experiments")
async def list_experiments_api(
    lobster_name: str | None = None,
    source: str | None = None,
    status: str | None = None,
    limit: int = 50,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from experiment_registry import get_experiment_registry

    items = get_experiment_registry().list_experiments(
        tenant_id=current_user.tenant_id,
        lobster_name=lobster_name,
        source=source,
        status=status,
        limit=limit,
    )
    return {"ok": True, "items": items}


@app.post("/api/v1/experiments")
async def create_experiment_api(
    body: ExperimentCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from experiment_registry import get_experiment_registry

    created = get_experiment_registry().create(
        name=body.name,
        lobster_name=body.lobster_name,
        prompt_name=body.prompt_name,
        prompt_version=body.prompt_version,
        model=body.model,
        dataset_id=body.dataset_id,
        tenant_id=current_user.tenant_id,
        source=body.source,
        metrics=body.metrics,
        config=body.config,
        notes=body.notes,
        status=body.status,
    )
    return {"ok": True, "experiment": created}


@app.get("/api/v1/experiments/{experiment_id}")
async def get_experiment_api(experiment_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from experiment_registry import get_experiment_registry

    payload = get_experiment_registry().get_experiment(experiment_id)
    if not payload:
        raise HTTPException(status_code=404, detail="experiment_not_found")
    if str(payload.get("tenant_id") or "") != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    return {"ok": True, "experiment": payload}


@app.post("/api/v1/experiments/{experiment_id}/run")
async def run_experiment_api(
    experiment_id: str,
    body: ExperimentRunRequest,
    background_tasks: BackgroundTasks,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from experiment_registry import get_experiment_registry

    registry = get_experiment_registry()
    payload = registry.get_experiment(experiment_id)
    if not payload:
        raise HTTPException(status_code=404, detail="experiment_not_found")
    if str(payload.get("tenant_id") or "") != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    registry.update_status(experiment_id, "running")
    background_tasks.add_task(_run_experiment_eval_background, experiment_id, body.concurrency)
    return {
        "ok": True,
        "experiment_id": experiment_id,
        "status": "running",
        "concurrency": body.concurrency,
    }


@app.post("/api/v1/rag/testsets/generate")
async def generate_rag_testset_api(
    body: RagTestsetGenerateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from llm_quality_judge import get_quality_judge
    from rag_testset_generator import RagTestsetGenerator

    target_tenant = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    if target_tenant != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    distribution = {
        str(key): float(value)
        for key, value in (body.distributions or {}).items()
        if str(key).strip()
    }
    result = await RagTestsetGenerator(get_quality_judge()._call_judge_llm).generate(  # noqa: SLF001
        tenant_id=target_tenant,
        test_size=body.test_size,
        distributions=distribution or None,
        save_to_dataset_store=body.save_to_dataset_store,
        dataset_name=str(body.dataset_name or "").strip() or None,
    )
    result["items"] = result.get("items", [])[:5]
    result["preview_only"] = True
    return {"ok": True, **result}


@app.post("/api/v1/logs/query")
async def query_logs_api(
    body: LogQueryRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from log_query_api import LogQueryApi

    result = LogQueryApi().query(
        sql=body.sql,
        tenant_id=current_user.tenant_id,
        time_range_hours=body.time_range_hours,
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=str(result.get("error") or "log_query_failed"))
    return result


@app.get("/api/v1/logs/templates")
async def log_query_templates_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from log_query_api import LogQueryApi

    return {"success": True, "items": LogQueryApi().get_query_templates()}


@app.get("/intake/{tenant_slug}", response_class=HTMLResponse)
async def intake_form_page(tenant_slug: str):
    from intake_form import render_intake_page

    return HTMLResponse(render_intake_page(tenant_slug))


@app.post("/intake/{tenant_slug}")
async def intake_form_submit(tenant_slug: str, body: dict[str, Any]):
    from intake_form import get_intake_form_handler

    handler = get_intake_form_handler()
    return handler.submit(
        tenant_slug=tenant_slug,
        tenant_id=tenant_slug,
        title=str(body.get("title") or ""),
        description=str(body.get("description") or ""),
        priority=str(body.get("priority") or "medium"),
        contact=str(body.get("contact") or ""),
    )


@app.get("/api/v1/intake/list")
async def intake_list_api(
    status: str = Query(default="pending"),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from intake_form import get_intake_form_handler

    return {"ok": True, "items": get_intake_form_handler().list_submissions(current_user.tenant_id, status=status)}


@app.post("/api/v1/intake/{intake_id}/accept")
async def intake_accept_api(intake_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from intake_form import get_intake_form_handler
    from task_queue import get_task_queue

    handler = get_intake_form_handler()
    row = handler.get_submission(intake_id)
    if not row or str(row.get("tenant_id") or "") != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="intake_not_found")
    result = handler.accept(intake_id, current_user.tenant_id, current_user.sub)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=str(result.get("error") or "intake_accept_failed"))
    get_task_queue().enqueue(
        task_type="catcher_intake",
        payload={
            "lobster_name": "catcher",
            "title": f"[需求] {row.get('title')}",
            "description": row.get("description") or "",
            "source": "intake",
            "intake_id": intake_id,
            "contact": row.get("contact") or "",
            "priority": row.get("priority") or "medium",
        },
        tenant_id=current_user.tenant_id,
        priority=str(row.get("priority") or "medium"),
    )
    return {"ok": True, "accepted": True, "intake_id": intake_id}


@app.post("/api/v1/intake/{intake_id}/reject")
async def intake_reject_api(
    intake_id: str,
    body: dict[str, Any],
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from intake_form import get_intake_form_handler

    result = get_intake_form_handler().reject(
        intake_id,
        current_user.tenant_id,
        current_user.sub,
        str(body.get("reason") or ""),
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=str(result.get("error") or "intake_reject_failed"))
    return {"ok": True, "rejected": True, "intake_id": intake_id}


@app.get("/api/v1/tasks/kanban")
async def kanban_tasks_api(
    recent_hours: int = Query(default=24, ge=1, le=24 * 7),
    current_user: UserClaims = Depends(_decode_user),
):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from task_queue import get_task_queue

    items = get_task_queue().list_kanban_tasks(current_user.tenant_id, recent_hours=recent_hours, limit=200)
    return {"ok": True, "items": items}


@app.get("/api/v1/docs")
async def list_lobster_docs_api(
    lobster_name: str = Query(default=""),
    current_user: UserClaims = Depends(_decode_user),
):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from lobster_doc_store import get_lobster_doc_store

    return {
        "ok": True,
        "items": get_lobster_doc_store().list_docs(current_user.tenant_id, lobster_name=lobster_name),
    }


@app.get("/api/v1/docs/{doc_id}")
async def get_lobster_doc_api(doc_id: str, current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from lobster_doc_store import get_lobster_doc_store

    doc = get_lobster_doc_store().get_doc(doc_id, current_user.tenant_id)
    if not doc:
        raise HTTPException(status_code=404, detail="lobster_doc_not_found")
    return {"ok": True, "doc": doc}


@app.put("/api/v1/docs/{doc_id}")
async def update_lobster_doc_api(
    doc_id: str,
    body: LobsterDocUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from lobster_doc_store import get_lobster_doc_store

    result = get_lobster_doc_store().update_content(
        doc_id=doc_id,
        tenant_id=current_user.tenant_id,
        new_content=body.content,
        editor_id=current_user.sub,
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=str(result.get("error") or "lobster_doc_update_failed"))
    return {"ok": True, **result}


@app.get("/api/v1/docs/{doc_id}/versions")
async def lobster_doc_versions_api(doc_id: str, current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from lobster_doc_store import get_lobster_doc_store

    return {"ok": True, "items": get_lobster_doc_store().get_versions(doc_id, current_user.tenant_id)}


@app.get("/api/v1/edge/groups/tree")
async def edge_group_tree_api(current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from edge_node_group import get_edge_node_group_manager

    return {"ok": True, "items": get_edge_node_group_manager().get_group_tree(current_user.tenant_id)}


@app.get("/api/v1/edge/groups/node-map")
async def edge_group_node_map_api(current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from edge_node_group import get_edge_node_group_manager

    return {"ok": True, "items": get_edge_node_group_manager().get_node_group_map(current_user.tenant_id)}


@app.get("/api/v1/edge/groups/{group_id}/nodes")
async def edge_group_nodes_api(group_id: str, current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from edge_node_group import get_edge_node_group_manager

    return {
        "ok": True,
        "node_ids": get_edge_node_group_manager().get_nodes_in_group(current_user.tenant_id, group_id),
    }


@app.post("/api/v1/edge/groups")
async def create_edge_group_api(
    body: EdgeNodeGroupCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from edge_node_group import get_edge_node_group_manager

    group = get_edge_node_group_manager().create_group(
        name=body.name,
        tenant_id=current_user.tenant_id,
        parent_group_id=str(body.parent_group_id or "").strip() or None,
        description=body.description,
        tags=body.tags,
    )
    return {"ok": True, "group": group}


@app.post("/api/v1/edge/groups/{group_id}/nodes/{node_id}")
async def add_edge_node_to_group_api(group_id: str, node_id: str, current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from edge_node_group import get_edge_node_group_manager

    result = get_edge_node_group_manager().add_node_to_group(
        tenant_id=current_user.tenant_id,
        node_id=node_id,
        group_id=group_id,
    )
    return {"ok": True, "assignment": result}


@app.delete("/api/v1/edge/groups/{group_id}/nodes/{node_id}")
async def remove_edge_node_from_group_api(group_id: str, node_id: str, current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from edge_node_group import get_edge_node_group_manager

    removed = get_edge_node_group_manager().remove_node_from_group(
        tenant_id=current_user.tenant_id,
        node_id=node_id,
    )
    return {"ok": True, "removed": removed, "group_id": group_id, "node_id": node_id}


@app.post("/api/v1/lobster-trigger-rules")
async def upsert_lobster_trigger_rule_api(
    body: LobsterTriggerRuleUpsertRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from activity_stream import get_activity_stream
    from lobster_trigger_rules import get_lobster_trigger_rule_store

    payload = body.model_dump()
    payload["tenant_id"] = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    rule = get_lobster_trigger_rule_store().upsert_rule(payload)
    await get_activity_stream().record_rule_change(
        tenant_id=current_user.tenant_id,
        actor_id=str(current_user.sub or "admin"),
        actor_name=str(current_user.sub or "admin"),
        rule_id=str(rule.get("rule_id") or ""),
        rule_name=str(rule.get("name") or ""),
        change_type="create",
        details={"target_type": "lobster_trigger_rule", "conditions": len(rule.get("conditions", []))},
    )
    return {"ok": True, "rule": rule}


@app.get("/api/v1/lobster-trigger-rules")
async def list_lobster_trigger_rules_api(current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from lobster_trigger_rules import get_lobster_trigger_rule_store

    return {"ok": True, "items": get_lobster_trigger_rule_store().list_rules(current_user.tenant_id)}


@app.put("/api/v1/lobster-trigger-rules/{rule_id}")
async def update_lobster_trigger_rule_api(
    rule_id: str,
    body: LobsterTriggerRuleUpsertRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from activity_stream import get_activity_stream
    from lobster_trigger_rules import get_lobster_trigger_rule_store

    payload = body.model_dump()
    payload["rule_id"] = rule_id
    payload["tenant_id"] = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    rule = get_lobster_trigger_rule_store().upsert_rule(payload)
    await get_activity_stream().record_rule_change(
        tenant_id=current_user.tenant_id,
        actor_id=str(current_user.sub or "admin"),
        actor_name=str(current_user.sub or "admin"),
        rule_id=rule_id,
        rule_name=str(rule.get("name") or rule_id),
        change_type="update",
        details={"target_type": "lobster_trigger_rule", "conditions": len(rule.get("conditions", []))},
    )
    return {"ok": True, "rule": rule}


@app.delete("/api/v1/lobster-trigger-rules/{rule_id}")
async def delete_lobster_trigger_rule_api(rule_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from activity_stream import get_activity_stream
    from lobster_trigger_rules import get_lobster_trigger_rule_store

    deleted = get_lobster_trigger_rule_store().delete_rule(rule_id, current_user.tenant_id)
    if deleted:
        await get_activity_stream().record_rule_change(
            tenant_id=current_user.tenant_id,
            actor_id=str(current_user.sub or "admin"),
            actor_name=str(current_user.sub or "admin"),
            rule_id=rule_id,
            rule_name=rule_id,
            change_type="delete",
            details={"target_type": "lobster_trigger_rule"},
        )
    return {"ok": True, "deleted": deleted}


@app.post("/api/v1/lobster-trigger-rules/evaluate")
async def evaluate_lobster_trigger_rules_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    engine = getattr(app.state, "lobster_trigger_engine", None)
    if engine is None:
        raise HTTPException(status_code=503, detail="trigger_engine_not_ready")
    return {"ok": True, "results": await engine.evaluate_once()}


@app.get("/api/v1/activities")
async def list_activities_api(
    activity_type: str | None = Query(default=None),
    actor_id: str | None = Query(default=None),
    target_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from activity_stream import get_activity_stream

    items, total = get_activity_stream().store.list(
        tenant_id=current_user.tenant_id,
        activity_type=str(activity_type).strip() if activity_type else None,
        actor_id=str(actor_id).strip() if actor_id else None,
        target_id=str(target_id).strip() if target_id else None,
        page=page,
        page_size=page_size,
    )
    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@app.get("/api/v1/activities/{activity_id}")
async def get_activity_api(activity_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from activity_stream import get_activity_stream

    item = get_activity_stream().store.get(activity_id)
    if item is None or item.get("tenant_id") != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="activity_not_found")
    return {"ok": True, "activity": item}


@app.get("/api/v1/jobs/registry")
async def list_job_registry_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from job_registry import get_job_registry

    return {"ok": True, "items": get_job_registry().list_jobs()}


@app.get("/api/v1/modules")
async def list_modules_api(
    lobster_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    registry = get_module_registry()
    if lobster_id:
        items = registry.get_available_modules(str(lobster_id).strip())
    else:
        items = registry.list_all()
    return {"ok": True, "items": items}


@app.get("/api/v1/policies")
async def list_policies_api(
    policy_path: str | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    include_disabled: bool = Query(default=True),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = _resolve_policy_tenant_id(tenant_id, current_user)
    items = get_policy_engine().list_rules(
        policy_path=str(policy_path).strip() if policy_path else None,
        tenant_id=target_tenant,
        include_disabled=include_disabled,
        effective=True,
    )
    return {"ok": True, "tenant_id": target_tenant, "items": items}


@app.post("/api/v1/policies")
async def create_policy_api(
    body: PolicyRuleRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    payload = body.model_dump()
    payload["tenant_id"] = _resolve_policy_tenant_id(body.tenant_id, current_user)
    rule = get_policy_engine().upsert_rule(payload)
    bundle = get_policy_bundle_manager().publish(
        tenant_id=str(rule.get("tenant_id") or current_user.tenant_id),
        published_by=str(current_user.sub or "system"),
        notes=f"policy_rule_upsert:{rule['rule_id']}",
        force=True,
    )
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        actor_id=current_user.sub,
        resource_type="policy_rule",
        resource_id=str(rule["rule_id"]),
        details={
            "action": "policy_rule_upsert",
            "policy_path": rule.get("policy_path"),
            "target_tenant": rule.get("tenant_id"),
            "bundle_version": bundle.get("version"),
        },
    )
    return {"ok": True, "rule": rule, "bundle": bundle}


@app.put("/api/v1/policies/{rule_id}")
async def update_policy_api(
    rule_id: str,
    body: PolicyRuleRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    payload = body.model_dump()
    payload["rule_id"] = rule_id
    payload["tenant_id"] = _resolve_policy_tenant_id(body.tenant_id, current_user)
    rule = get_policy_engine().upsert_rule(payload)
    bundle = get_policy_bundle_manager().publish(
        tenant_id=str(rule.get("tenant_id") or current_user.tenant_id),
        published_by=str(current_user.sub or "system"),
        notes=f"policy_rule_update:{rule['rule_id']}",
        force=True,
    )
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        actor_id=current_user.sub,
        resource_type="policy_rule",
        resource_id=str(rule["rule_id"]),
        details={
            "action": "policy_rule_update",
            "policy_path": rule.get("policy_path"),
            "target_tenant": rule.get("tenant_id"),
            "bundle_version": bundle.get("version"),
        },
    )
    return {"ok": True, "rule": rule, "bundle": bundle}


@app.delete("/api/v1/policies/{rule_id}")
async def delete_policy_api(
    rule_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    existing = get_policy_engine().get_rule(rule_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="policy_not_found")
    deleted = get_policy_engine().delete_rule(rule_id)
    bundle = get_policy_bundle_manager().publish(
        tenant_id=str(existing.get("tenant_id") or current_user.tenant_id),
        published_by=str(current_user.sub or "system"),
        notes=f"policy_rule_delete:{rule_id}",
        force=True,
    )
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        actor_id=current_user.sub,
        resource_type="policy_rule",
        resource_id=rule_id,
        details={
            "action": "policy_rule_delete",
            "policy_path": existing.get("policy_path"),
            "target_tenant": existing.get("tenant_id"),
            "bundle_version": bundle.get("version"),
        },
    )
    return {"ok": True, "deleted": deleted, "bundle": bundle}


@app.post("/api/v1/policies/evaluate")
async def evaluate_policy_api(
    body: PolicyEvaluateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = _resolve_policy_tenant_id(body.tenant_id, current_user)
    decision = get_policy_engine().evaluate(
        body.input_data,
        policy_path=body.policy_path,
        tenant_id=target_tenant,
        default_decision=body.default_decision,
        trace=body.trace,
    )
    bundle = get_policy_bundle_manager().current_bundle(target_tenant)
    decision["bundle_version"] = bundle.get("version")
    decision["bundle_checksum"] = bundle.get("checksum")
    log_record = await get_decision_logger().log(
        decision,
        {
            "tenant_id": target_tenant,
            "input_data": body.input_data,
            "lobster_id": body.lobster_id,
            "task_id": body.task_id,
        },
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "decision": decision,
        "decision_log_id": log_record.log_id,
    }


@app.get("/api/v1/policies/bundle/current")
async def current_policy_bundle_api(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = _resolve_policy_tenant_id(tenant_id, current_user)
    return {"ok": True, "tenant_id": target_tenant, "bundle": get_policy_bundle_manager().current_bundle(target_tenant)}


@app.post("/api/v1/policies/bundle/publish")
async def publish_policy_bundle_api(
    body: PolicyBundlePublishRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = _resolve_policy_tenant_id(body.tenant_id, current_user)
    bundle = get_policy_bundle_manager().publish(
        tenant_id=target_tenant,
        version=body.version,
        published_by=str(current_user.sub or "system"),
        notes=str(body.notes or "manual_publish"),
        policy_paths=[str(item).strip() for item in body.policy_paths if str(item).strip()],
        force=body.force,
    )
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        actor_id=current_user.sub,
        resource_type="policy_bundle",
        resource_id=str(bundle["bundle_id"]),
        details={
            "action": "policy_bundle_publish",
            "target_tenant": target_tenant,
            "version": bundle.get("version"),
            "checksum": bundle.get("checksum"),
            "rule_count": bundle.get("rule_count"),
        },
    )
    return {"ok": True, "tenant_id": target_tenant, "bundle": bundle}


@app.get("/api/v1/audit/decisions")
async def list_policy_decisions_api(
    tenant_id: str | None = Query(default=None),
    policy_path: str | None = Query(default=None),
    decision: str | None = Query(default=None),
    rule_id: str | None = Query(default=None),
    lobster_id: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = _resolve_policy_tenant_id(tenant_id, current_user)
    items, total = get_decision_logger().list_logs(
        target_tenant,
        policy_path=str(policy_path).strip() if policy_path else None,
        decision=str(decision).strip() if decision else None,
        rule_id=str(rule_id).strip() if rule_id else None,
        lobster_id=str(lobster_id).strip() if lobster_id else None,
        start=start,
        end=end,
        page=page,
        page_size=page_size,
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
    }


@app.get("/api/v1/audit/decisions/stats")
async def policy_decision_stats_api(
    tenant_id: str | None = Query(default=None),
    policy_path: str | None = Query(default=None),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = _resolve_policy_tenant_id(tenant_id, current_user)
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "stats": get_decision_logger().stats(
            target_tenant,
            policy_path=str(policy_path).strip() if policy_path else None,
            start=start,
            end=end,
        ),
    }


@app.get("/api/v1/audit/decisions/{log_id}")
async def get_policy_decision_api(
    log_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    item = get_decision_logger().get_log(log_id)
    if item is None:
        raise HTTPException(status_code=404, detail="decision_log_not_found")
    if item.get("tenant_id") not in {current_user.tenant_id, POLICY_GLOBAL_TENANT} and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Tenant access denied")
    return {"ok": True, "decision_log": item}


@app.get("/api/v1/metrics/lobster/{lobster_name}/history")
async def lobster_metrics_history_api(
    lobster_name: str,
    days: int = Query(default=30, ge=1, le=365),
    current_user: UserClaims = Depends(_decode_user),
):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from lobster_metrics_history import get_lobster_metrics_history

    return {
        "ok": True,
        "items": get_lobster_metrics_history().get_history(lobster_name, current_user.tenant_id, days=days),
    }


@app.get("/api/v1/prompts")
async def list_prompts_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from prompt_registry import get_prompt_registry

    return {"ok": True, "items": get_prompt_registry().list_prompts()}


@app.get("/api/v1/prompts/{prompt_name}/versions")
async def list_prompt_versions_api(prompt_name: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from prompt_registry import get_prompt_registry

    return {"ok": True, "items": get_prompt_registry().list_versions(prompt_name)}


@app.get("/api/v1/prompts/{prompt_name}/diff")
async def prompt_diff_api(
    prompt_name: str,
    version_a: int,
    version_b: int,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from prompt_registry import get_prompt_registry

    payload = get_prompt_registry().diff(prompt_name, version_a, version_b)
    if payload.get("error"):
        raise HTTPException(status_code=404, detail=str(payload.get("error")))
    return {"ok": True, "diff": payload}


@app.get("/api/v1/rbac/permissions")
async def list_rbac_permissions_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    rows = [item.to_dict() for item in get_rbac_service().list_permissions(current_user.tenant_id)]
    return {"ok": True, "tenant_id": current_user.tenant_id, "permissions": rows}


@app.post("/api/v1/rbac/permissions")
async def create_rbac_permission_api(
    body: ResourcePermissionRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    tenant_id = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    perm = get_rbac_service().grant_permission(
        ResourcePermission(
            id=f"perm_{uuid.uuid4().hex[:12]}",
            tenant_id=tenant_id,
            resource_type=ResourceType(str(body.resource_type)),
            resource_id=body.resource_id,
            scope=ResourceScope(str(body.scope)),
            subject_type=str(body.subject_type),
            subject_id=str(body.subject_id).strip().lower(),
            granted=body.granted,
            note=str(body.note or ""),
        )
    )
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=tenant_id,
        user_id=current_user.sub,
        resource_type="rbac_permission",
        resource_id=perm.id,
        details={"permission": perm.to_dict()},
    )
    return {"ok": True, "permission": perm.to_dict()}


@app.delete("/api/v1/rbac/permissions/{permission_id}")
async def delete_rbac_permission_api(permission_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    deleted = get_rbac_service().revoke_permission(permission_id)
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="rbac_permission",
        resource_id=permission_id,
        details={"deleted": deleted},
    )
    return {"ok": True, "deleted": deleted}


@app.get("/api/v1/rbac/users/{user_id}/permissions")
async def list_user_rbac_permissions_api(
    user_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user")
    roles = current_user.roles if user_id == current_user.sub else []
    rows = [item.to_dict() for item in get_rbac_service().list_user_permissions(user_id, current_user.tenant_id, roles)]
    return {"ok": True, "tenant_id": current_user.tenant_id, "user_id": user_id, "permissions": rows}


@app.post("/api/v1/rbac/check")
async def rbac_check_api(
    body: ResourcePermissionCheckRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    tenant_id = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    allowed, matched_rule, reason = get_rbac_service().check_resource_permission(
        user_id=body.user_id,
        tenant_id=tenant_id,
        resource_type=ResourceType(str(body.resource_type)),
        resource_id=body.resource_id,
        scope=ResourceScope(str(body.scope)),
        roles=body.roles,
    )
    return {
        "ok": True,
        "allowed": allowed,
        "reason": reason,
        "matched_rule": matched_rule.to_dict() if matched_rule else None,
    }


@app.get("/api/v1/rbac/matrix")
async def rbac_matrix_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "matrix": get_rbac_service().get_permissions_matrix(), "roles": get_rbac_service().get_available_roles()}


@app.get("/api/v1/audit/event-types")
async def audit_event_types_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "items": get_audit_service().list_event_types()}


@app.get("/api/v1/audit/events")
async def audit_events_api(
    event_type: list[str] | None = Query(default=None),
    severity: list[str] | None = Query(default=None),
    category: list[str] | None = Query(default=None),
    user_id: str | None = Query(default=None),
    resource_id: str | None = Query(default=None),
    from_ts: str | None = Query(default=None, alias="from"),
    to_ts: str | None = Query(default=None, alias="to"),
    include_deleted: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    page: int = Query(default=1, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=500),
    sort_by: str = Query(default="created_at"),
    sort_dir: str = Query(default="desc"),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    items, total = get_audit_service().query_paginated(
        current_user.tenant_id,
        event_types=event_type,
        severity=severity,
        category=category,
        user_id=user_id,
        resource_id=resource_id,
        from_ts=from_ts,
        to_ts=to_ts,
        include_deleted=include_deleted,
        page=page,
        page_size=page_size or limit,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    response = PaginatedResponse.from_items(
        items,
        total=total,
        page=page,
        page_size=page_size or limit,
    )
    return {"ok": True, "tenant_id": current_user.tenant_id, **response.to_dict()}


@app.post("/api/v1/audit/cleanup")
async def audit_cleanup_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    result = get_audit_service().cleanup_expired(current_user.tenant_id)
    return {"ok": True, "tenant_id": current_user.tenant_id, "result": result}


@app.get("/api/v1/alerts/rules")
async def list_alert_rules_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    rules = [rule.to_dict() for rule in get_alert_engine().store.list_rules(current_user.tenant_id)]
    return {"ok": True, "tenant_id": current_user.tenant_id, "items": rules}


@app.post("/api/v1/alerts/rules")
async def create_alert_rule_api(body: AlertRuleRequest, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    rule = AlertRule(
        rule_id=f"rule_{uuid.uuid4().hex[:12]}",
        name=body.name,
        description=body.description,
        metric=body.metric,
        aggregation=body.aggregation,
        condition=body.condition,
        threshold=body.threshold,
        window_seconds=body.window_seconds,
        pending_seconds=body.pending_seconds,
        silence_seconds=body.silence_seconds,
        severity=AlertSeverity(body.severity),
        lobster_filter=body.lobster_filter,
        tenant_filter=body.tenant_filter or current_user.tenant_id,
        edge_node_filter=body.edge_node_filter,
        notification_channel_ids=body.notification_channel_ids,
        enabled=body.enabled,
        tenant_id=current_user.tenant_id,
        created_by=current_user.sub,
    )
    saved = get_alert_engine().store.upsert_rule(rule)
    return {"ok": True, "rule": saved.to_dict()}


@app.put("/api/v1/alerts/rules/{rule_id}")
async def update_alert_rule_api(rule_id: str, body: AlertRuleRequest, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    existing = get_alert_engine().store.get_rule(rule_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="alert_rule_not_found")
    existing.name = body.name
    existing.description = body.description
    existing.metric = body.metric
    existing.aggregation = body.aggregation
    existing.condition = body.condition
    existing.threshold = body.threshold
    existing.window_seconds = body.window_seconds
    existing.pending_seconds = body.pending_seconds
    existing.silence_seconds = body.silence_seconds
    existing.severity = AlertSeverity(body.severity)
    existing.lobster_filter = body.lobster_filter
    existing.tenant_filter = body.tenant_filter or current_user.tenant_id
    existing.edge_node_filter = body.edge_node_filter
    existing.notification_channel_ids = body.notification_channel_ids
    existing.enabled = body.enabled
    saved = get_alert_engine().store.upsert_rule(existing)
    return {"ok": True, "rule": saved.to_dict()}


@app.post("/api/v1/alerts/evaluate")
async def evaluate_alert_rules_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    events = [event.to_dict() for event in await get_alert_engine().evaluate_all()]
    return {"ok": True, "tenant_id": current_user.tenant_id, "events": events}


@app.get("/api/v1/alerts/events")
async def list_alert_events_api(limit: int = Query(default=100, ge=1, le=500), current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    items = [event.to_dict() for event in get_alert_engine().store.list_events(current_user.tenant_id, limit=limit)]
    return {"ok": True, "tenant_id": current_user.tenant_id, "items": items}


@app.get("/api/v1/alerts/channels")
async def list_alert_channels_api(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    items = [channel.to_dict() for channel in get_alert_engine().store.list_channels(current_user.tenant_id)]
    return {"ok": True, "tenant_id": current_user.tenant_id, "items": items}


@app.post("/api/v1/alerts/channels")
async def create_alert_channel_api(body: NotificationChannelRequest, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    channel = NotificationChannel(
        channel_id=f"chan_{uuid.uuid4().hex[:12]}",
        name=body.name,
        channel_type=body.channel_type,
        config=body.config,
        severity_filter=body.severity_filter,
        enabled=body.enabled,
        tenant_id=current_user.tenant_id,
    )
    saved = get_alert_engine().store.upsert_channel(channel)
    return {"ok": True, "channel": saved.to_dict()}


@app.get("/api/v1/white-label/resolve")
async def resolve_white_label_api(
    tenant_id: str | None = Query(default=None),
    host: str | None = Query(default=None),
):
    manager = get_white_label_manager()
    resolved_tenant = manager.resolve_tenant(tenant_id=tenant_id, host=host)
    config = manager.get_config(resolved_tenant)
    return {
        "ok": True,
        "tenant_id": resolved_tenant,
        "config": asdict(config),
        "css_vars": manager.get_css_vars(resolved_tenant),
        "meta": manager.get_meta_tags(resolved_tenant),
    }


@app.get("/api/v1/white-label/{tenant_id}")
async def get_white_label_api(tenant_id: str):
    config = get_white_label_manager().get_config(tenant_id)
    return {"ok": True, "config": asdict(config)}


@app.get("/api/v1/white-label/{tenant_id}/preview")
async def preview_white_label_api(tenant_id: str):
    manager = get_white_label_manager()
    config = manager.get_config(tenant_id)
    return {"ok": True, "config": asdict(config), "css_vars": manager.get_css_vars(tenant_id), "meta": manager.get_meta_tags(tenant_id)}


@app.put("/api/v1/white-label/{tenant_id}")
async def update_white_label_api(
    tenant_id: str,
    body: WhiteLabelUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    if tenant_id != current_user.tenant_id and "owner" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    manager = get_white_label_manager()
    current = manager.get_config(tenant_id)
    payload = asdict(current)
    payload.update({key: value for key, value in body.model_dump().items() if value is not None})
    saved = manager.save_config(WhiteLabelConfig(**payload))
    await get_audit_service().log(
        event_type=AuditEventType.WHITE_LABEL_UPDATE,
        tenant_id=tenant_id,
        user_id=current_user.sub,
        resource_type="white_label",
        resource_id=tenant_id,
        details={"updated_fields": [key for key, value in body.model_dump().items() if value is not None]},
    )
    return {"ok": True, "config": asdict(saved)}


@app.post("/api/v1/white-label/{tenant_id}/logo")
async def upload_white_label_logo_api(
    tenant_id: str,
    body: WhiteLabelLogoUploadRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    manager = get_white_label_manager()
    try:
        import base64

        content = base64.b64decode(body.content_base64)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="invalid_base64_logo") from exc
    url = manager.upload_asset(tenant_id, body.filename or "logo.png", content, asset_type="logo")
    current = manager.get_config(tenant_id)
    current.brand_logo_url = url
    current.updated_at = datetime.now(timezone.utc).isoformat()
    manager.save_config(current)
    await get_audit_service().log(
        event_type=AuditEventType.WHITE_LABEL_UPDATE,
        tenant_id=tenant_id,
        user_id=current_user.sub,
        resource_type="white_label",
        resource_id=tenant_id,
        details={"asset_type": "logo", "url": url},
    )
    return {"ok": True, "url": url}


@app.delete("/api/v1/white-label/{tenant_id}")
async def delete_white_label_api(tenant_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "owner" not in current_user.roles and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    if tenant_id != current_user.tenant_id and "owner" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    deleted = get_white_label_manager().delete_config(tenant_id)
    return {"ok": True, "deleted": deleted}


@app.get("/white-label-assets/{tenant_id}/{asset_name}", include_in_schema=False)
async def white_label_asset_file(tenant_id: str, asset_name: str):
    base_dir = Path(os.getenv("WHITE_LABEL_ASSET_DIR", "data/white_label_assets"))
    if not base_dir.is_absolute():
        base_dir = (Path(__file__).resolve().parent / base_dir).resolve()
    path = base_dir / tenant_id / asset_name
    if not path.exists():
        raise HTTPException(status_code=404, detail="asset_not_found")
    return FileResponse(path)


@app.post("/api/v1/lobsters/{lobster_id}/execute")
async def execute_single_lobster_api(
    lobster_id: str,
    body: LobsterExecuteRequest,
    current_user: UserClaims = Depends(_decode_user),
    _tenant_ctx: TenantContext = require_resource_permission(ResourceType.LOBSTER, ResourceScope.EXECUTE, "lobster_id"),
):
    lobster = _build_runtime_lobster(lobster_id, current_user.tenant_id)
    industry_hint = str(body.industry or body.industry_tag or "").strip()
    execution_mode = str(body.execution_mode or "auto").strip().lower() or "auto"
    spec = LobsterRunSpec(
        role_id=lobster_id,
        system_prompt=getattr(lobster, "system_prompt_full", "") or f"You are {lobster_id}.",
        user_prompt=body.prompt,
        lobster=lobster,
        peer_id=body.peer_id or current_user.sub,
        session_mode=body.session_mode,
        fresh_context=body.fresh_context,
        meta={
            "tenant_id": current_user.tenant_id,
            "user_id": current_user.sub,
            "task_type": f"lobster_execute_{lobster_id}",
            "approved": True,
            "channel": "console",
            "industry": industry_hint or None,
            "industry_tag": industry_hint or None,
            "enable_output_validation": bool(body.enable_output_validation),
            "auto_retry_on_violation": bool(body.auto_retry_on_violation),
            "reply_channel_id": str(body.reply_channel_id or "").strip() or None,
            "reply_chat_id": str(body.reply_chat_id or "").strip() or None,
        },
    )
    from lobster_pool_manager import AsyncLaunchedResult
    from lobster_pool_manager import get_notification_queue
    from lobster_runner import LobsterExecutionMode
    from lobster_runner import run_lobster_with_background_support

    mode = {
        "foreground": LobsterExecutionMode.FOREGROUND,
        "background": LobsterExecutionMode.BACKGROUND,
        "auto": LobsterExecutionMode.AUTO,
    }[execution_mode]

    def _background_hint(_run_id: str, _description: str) -> None:
        return

    runner = LobsterRunner(llm_router)
    outcome = await run_lobster_with_background_support(
        runner,
        spec,
        description=f"{lobster_id}:{body.prompt[:60]}",
        mode=mode,
        notification_queue=get_notification_queue(),
        on_background_hint=_background_hint,
    )
    if isinstance(outcome, AsyncLaunchedResult):
        return {
            "ok": True,
            **outcome.to_dict(),
        }
    result = outcome
    doc_id: str | None = None
    citations: list[dict[str, Any]] = []
    processed_content = result.final_content
    if result.final_content:
        try:
            from content_citation import get_content_citation_processor

            processed_content, citations = get_content_citation_processor().process(
                str(result.final_content),
                tenant_id=current_user.tenant_id,
                lobster_id=lobster_id,
            )
            result.final_content = processed_content
        except Exception as exc:  # noqa: BLE001
            logger.warning("Content citation processing failed for %s: %s", lobster_id, exc)
            processed_content = result.final_content
            citations = []
    if processed_content:
        try:
            from lobster_doc_store import get_lobster_doc_store

            doc_id = get_lobster_doc_store().auto_save_from_task(
                task_id=f"execute_{lobster_id}_{int(time.time())}",
                lobster_name=lobster_id,
                tenant_id=current_user.tenant_id,
                output=str(processed_content),
                title=f"{lobster_id} 输出",
            )
        except Exception:
            doc_id = None
    await get_audit_service().log(
        event_type=AuditEventType.LOBSTER_EXECUTE if not result.error else AuditEventType.LOBSTER_EXECUTE_FAILED,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="lobster",
        resource_id=lobster_id,
        details={"stop_reason": result.stop_reason, "error": result.error, "citation_count": len(citations), "failure_reason": result.failure_reason},
    )
    survey_suggestions = _survey_suggestions_for_event(
        "lobster_task_completed",
        current_user=current_user,
        task_id=f"execute_{lobster_id}_{int(time.time())}",
    )
    return {
        "ok": result.error is None,
        "result": processed_content,
        "stop_reason": result.stop_reason,
        "error": result.error,
        "failure_reason": result.failure_reason,
        "doc_id": doc_id,
        "citations": citations,
        "survey_suggestions": survey_suggestions,
    }


@app.get("/api/v1/voice/health")
async def voice_health_api(current_user: UserClaims = Depends(_decode_user)):
    base_url = str(os.getenv("VOXCPM_BASE_URL") or "http://voxcpm-service:8000").strip().rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{base_url}/healthz")
            response.raise_for_status()
            payload = response.json()
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "service": "voice-orchestrator",
            "provider": str(os.getenv("VOICE_PROVIDER") or "voxcpm").strip().lower() or "voxcpm",
            "error": str(exc),
        }
    return {
        "ok": True,
        "service": "voice-orchestrator",
        "provider": str(os.getenv("VOICE_PROVIDER") or "voxcpm").strip().lower() or "voxcpm",
        "backend": payload,
    }


@app.get("/api/v1/voice/profiles")
async def list_voice_profiles_api(current_user: UserClaims = Depends(_decode_user)):
    items = [
        profile.to_dict()
        for profile in get_voice_profile_registry().list_profiles(current_user.tenant_id)
    ]
    return {"ok": True, "items": items}


@app.post("/api/v1/voice/profiles")
async def create_voice_profile_api(
    body: VoiceProfileCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    profile = get_voice_profile_registry().create_profile(
        tenant_id=current_user.tenant_id,
        name=body.name,
        owner_type=body.owner_type,
        reference_audio_path=body.reference_audio_path,
        voice_prompt=str(body.voice_prompt or "").strip(),
        language=body.language,
        sample_rate=body.sample_rate,
        consent_doc_id=str(body.consent_doc_id or "").strip(),
        clone_enabled=bool(body.clone_enabled),
        tags=body.tags,
        meta={**body.meta, "created_by": current_user.sub},
    )
    artifact_id = get_artifact_store().save(
        run_id=f"voice_profile_{profile.profile_id}",
        lobster="visualizer",
        artifact_type="voice_profile",
        content=profile.name,
        status="draft",
        meta=profile.to_dict(),
    )
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="voice_profile",
        resource_id=profile.profile_id,
        details={"artifact_id": artifact_id, "clone_enabled": profile.clone_enabled},
    )
    return {"ok": True, "profile": profile.to_dict(), "artifact_id": artifact_id}


@app.get("/api/v1/voice/profiles/{profile_id}")
async def get_voice_profile_api(profile_id: str, current_user: UserClaims = Depends(_decode_user)):
    profile = get_voice_profile_registry().get_profile(profile_id)
    if profile is None or profile.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="voice_profile_not_found")
    return {"ok": True, "profile": profile.to_dict()}


@app.post("/api/v1/voice/profiles/{profile_id}/disable")
async def disable_voice_profile_api(profile_id: str, current_user: UserClaims = Depends(_decode_user)):
    profile = get_voice_profile_registry().get_profile(profile_id)
    if profile is None or profile.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="voice_profile_not_found")
    ok = get_voice_profile_registry().disable_profile(profile_id)
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="voice_profile",
        resource_id=profile_id,
        details={"disabled": ok},
    )
    return {"ok": True, "disabled": ok, "profile_id": profile_id}


@app.post("/api/v1/voice/profiles/{profile_id}/approve")
async def approve_voice_profile_api(
    profile_id: str,
    body: VoiceReviewActionRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    profile = get_voice_profile_registry().get_profile(profile_id)
    if profile is None or profile.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="voice_profile_not_found")
    ok = get_voice_profile_registry().set_review_status(
        profile_id,
        status="approved",
        reviewer=current_user.sub,
        note=str(body.note or "").strip(),
    )
    return {"ok": True, "approved": ok, "profile_id": profile_id}


@app.post("/api/v1/voice/profiles/{profile_id}/reject")
async def reject_voice_profile_api(
    profile_id: str,
    body: VoiceReviewActionRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    profile = get_voice_profile_registry().get_profile(profile_id)
    if profile is None or profile.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="voice_profile_not_found")
    ok = get_voice_profile_registry().set_review_status(
        profile_id,
        status="rejected",
        reviewer=current_user.sub,
        note=str(body.note or "").strip(),
    )
    return {"ok": True, "rejected": ok, "profile_id": profile_id}


@app.post("/api/v1/voice/profiles/{profile_id}/revoke")
async def revoke_voice_profile_api(
    profile_id: str,
    body: VoiceReviewActionRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    profile = get_voice_profile_registry().get_profile(profile_id)
    if profile is None or profile.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="voice_profile_not_found")
    ok = get_voice_profile_registry().set_review_status(
        profile_id,
        status="revoked",
        reviewer=current_user.sub,
        note=str(body.note or "").strip(),
    )
    return {"ok": True, "revoked": ok, "profile_id": profile_id}


@app.get("/api/v1/voice/consents")
async def list_voice_consents_api(current_user: UserClaims = Depends(_decode_user)):
    items = [
        consent.to_dict()
        for consent in get_voice_consent_registry().list_consents(current_user.tenant_id)
    ]
    return {"ok": True, "items": items}


@app.post("/api/v1/voice/consents")
async def create_voice_consent_api(
    body: VoiceConsentCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    consent = get_voice_consent_registry().create_consent(
        tenant_id=current_user.tenant_id,
        owner_name=body.owner_name,
        owner_type=body.owner_type,
        consent_doc_id=body.consent_doc_id,
        scope=body.scope,
        reference_audio_path=body.reference_audio_path,
        notes=str(body.notes or "").strip(),
        meta={**body.meta, "created_by": current_user.sub},
    )
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="voice_consent",
        resource_id=consent.consent_id,
        details={"scope": consent.scope, "owner_type": consent.owner_type},
    )
    return {"ok": True, "consent": consent.to_dict()}


@app.get("/api/v1/voice/consents/{consent_id}")
async def get_voice_consent_api(consent_id: str, current_user: UserClaims = Depends(_decode_user)):
    consent = get_voice_consent_registry().get_consent(consent_id)
    if consent is None or consent.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="voice_consent_not_found")
    return {"ok": True, "consent": consent.to_dict()}


@app.post("/api/v1/voice/consents/{consent_id}/approve")
async def approve_voice_consent_api(
    consent_id: str,
    body: VoiceReviewActionRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    consent = get_voice_consent_registry().get_consent(consent_id)
    if consent is None or consent.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="voice_consent_not_found")
    ok = get_voice_consent_registry().set_review_status(
        consent_id,
        status="active",
        reviewer=current_user.sub,
        note=str(body.note or "").strip(),
    )
    return {"ok": True, "approved": ok, "consent_id": consent_id}


@app.post("/api/v1/voice/consents/{consent_id}/reject")
async def reject_voice_consent_api(
    consent_id: str,
    body: VoiceReviewActionRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    consent = get_voice_consent_registry().get_consent(consent_id)
    if consent is None or consent.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="voice_consent_not_found")
    ok = get_voice_consent_registry().set_review_status(
        consent_id,
        status="rejected",
        reviewer=current_user.sub,
        note=str(body.note or "").strip(),
    )
    return {"ok": True, "rejected": ok, "consent_id": consent_id}


@app.post("/api/v1/voice/consents/{consent_id}/revoke")
async def revoke_voice_consent_api(
    consent_id: str,
    body: VoiceReviewActionRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    consent = get_voice_consent_registry().get_consent(consent_id)
    if consent is None or consent.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="voice_consent_not_found")
    ok = get_voice_consent_registry().set_review_status(
        consent_id,
        status="revoked",
        reviewer=current_user.sub,
        note=str(body.note or "").strip(),
    )
    return {"ok": True, "revoked": ok, "consent_id": consent_id}


@app.post("/api/v1/voice/synthesize")
async def voice_synthesize_api(
    body: VoiceSynthesizeRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    voice_profile = dict(body.voice_profile or {})
    if body.voice_profile_id:
        profile = get_voice_profile_registry().get_profile(body.voice_profile_id)
        if profile is None or profile.tenant_id != current_user.tenant_id or not profile.enabled:
            raise HTTPException(status_code=404, detail="voice_profile_not_found")
        if str(profile.status or "").strip().lower() != "approved":
            raise HTTPException(status_code=403, detail="voice_profile_not_approved")
        voice_profile = profile.to_dict()
        if body.voice_mode == "brand_clone":
            if not profile.clone_enabled:
                raise HTTPException(status_code=403, detail="voice_profile_clone_disabled")
            consent_doc_id = str(profile.consent_doc_id or "").strip()
            if not consent_doc_id:
                raise HTTPException(status_code=403, detail="voice_profile_missing_consent")
            matching = [
                item
                for item in get_voice_consent_registry().list_consents(current_user.tenant_id)
                if str(item.consent_doc_id or "").strip() == consent_doc_id and str(item.status or "").strip().lower() == "active"
            ]
            if not matching:
                raise HTTPException(status_code=403, detail="voice_consent_not_active")

    result = await get_voice_orchestrator().synthesize_and_store(
        run_id=body.run_id,
        lobster_id=body.lobster_id,
        tenant_id=current_user.tenant_id,
        text=body.text,
        voice_mode=body.voice_mode,
        voice_prompt=str(body.voice_prompt or "").strip(),
        voice_profile=voice_profile,
        subtitle_required=bool(body.subtitle_required),
        step_index=body.step_index,
        triggered_by=str(body.triggered_by or "").strip() or None,
        meta={
            **body.meta,
            "tenant_id": current_user.tenant_id,
            "user_id": current_user.sub,
            "voice_profile_id": str(body.voice_profile_id or "").strip() or None,
        },
    )
    if not result.ok:
        raise HTTPException(status_code=502, detail=result.error or "voice_synthesize_failed")
    return {
        "ok": True,
        "provider": result.provider,
        "mode": result.mode,
        "audio_path": result.audio_path,
        "subtitle_srt_path": result.subtitle_srt_path,
        "duration_sec": result.duration_sec,
        "fallback_used": result.fallback_used,
        "artifact_ids": result.artifact_ids or [],
    }


@app.get("/api/lobster/notifications")
async def lobster_notifications(request: Request):
    from lobster_pool_manager import get_notification_queue

    async def event_generator():
        queue = get_notification_queue()
        while True:
            if await request.is_disconnected():
                break
            try:
                notification = await asyncio.wait_for(queue.get(), timeout=0.1)
                payload = {"xml": notification.to_xml(), **notification.to_dict()}
                yield f"event: task_notification\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
            except asyncio.TimeoutError:
                yield "event: ping\ndata: {}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/lobster/{run_id}/background")
async def push_lobster_task_to_background(run_id: str):
    from lobster_pool_manager import get_foreground_registry

    ok = get_foreground_registry().background_one(run_id)
    if not ok:
        raise HTTPException(status_code=404, detail="foreground_task_not_found")
    return {"status": "backgrounded", "run_id": run_id}


@app.post("/api/lobster/background-all")
async def push_all_lobsters_to_background():
    from lobster_pool_manager import get_foreground_registry

    count = get_foreground_registry().background_all()
    return {"status": "all_backgrounded", "count": count}


@app.get("/api/lobster/foreground")
async def list_foreground_tasks():
    from lobster_pool_manager import get_foreground_registry

    return {"tasks": get_foreground_registry().to_dict_list()}


@app.post("/api/v1/query-expander/expand")
async def query_expander_expand_api(
    body: QueryExpandRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from query_expander import QueryExpander

    target_tenant = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    result = await QueryExpander().expand(
        body.query,
        active_lobsters=body.active_lobsters,
        tenant_id=target_tenant,
    )
    return {"ok": True, "tenant_id": target_tenant, **result.to_dict()}


@app.get("/api/v1/connectors/credentials")
async def list_connector_credentials_api(current_user: UserClaims = Depends(_decode_user)):
    from connector_credential_store import get_connector_credential_store

    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    store = get_connector_credential_store()
    items = store.list_statuses(current_user.tenant_id)
    return {"ok": True, "tenant_id": current_user.tenant_id, "items": items, "count": len(items)}


@app.get("/api/v1/connectors/credentials/{connector}")
async def get_connector_credential_api(
    connector: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from connector_credential_store import get_connector_credential_store

    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    store = get_connector_credential_store()
    return {"ok": True, "item": store.get_status(current_user.tenant_id, connector)}


@app.put("/api/v1/connectors/credentials/{connector}")
async def upsert_connector_credential_api(
    connector: str,
    body: ConnectorCredentialUpsertRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from connector_credential_store import get_connector_credential_store

    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    store = get_connector_credential_store()
    ok = store.save_credential(
        current_user.tenant_id,
        connector,
        body.credential,
        updated_by=current_user.sub,
    )
    if not ok:
        raise HTTPException(status_code=400, detail="unsupported_connector")
    return {"ok": True, "item": store.get_status(current_user.tenant_id, connector)}


@app.delete("/api/v1/connectors/credentials/{connector}")
async def delete_connector_credential_api(
    connector: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from connector_credential_store import get_connector_credential_store

    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    deleted = get_connector_credential_store().delete_credential(current_user.tenant_id, connector)
    return {"ok": True, "deleted": deleted}


@app.get("/api/v1/widget/config")
async def get_widget_config_api(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "owner" not in current_user.roles and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    return {"ok": True, "config": _get_widget_server().get_config(target_tenant)}


@app.put("/api/v1/widget/config")
async def update_widget_config_api(
    body: WidgetConfigUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    tenant_id = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    payload = {key: value for key, value in body.model_dump().items() if key != "tenant_id" and value is not None}
    return {"ok": True, "config": _get_widget_server().update_config(tenant_id, payload)}


@app.get("/api/v1/widget/script/{widget_id}", include_in_schema=False)
async def widget_loader_script_api(widget_id: str, request: Request):
    config = _get_widget_server().get_config_by_widget(widget_id)
    if not config:
        raise HTTPException(status_code=404, detail="widget_not_found")
    base_url = str(request.base_url).rstrip("/")
    script = _get_widget_server().render_loader_script(widget_id, base_url=base_url)
    return Response(content=script, media_type="application/javascript")


@app.post("/api/v1/widget/message")
async def widget_message_api(body: WidgetMessageRequest, request: Request):
    origin = str(request.headers.get("origin") or "")
    payload = await _get_widget_server().handle_visitor_message(
        widget_id=body.widget_id,
        session_id=body.session_id,
        message=body.message,
        visitor_meta=body.visitor_meta,
        origin=origin,
    )
    if not payload.get("ok", True):
        raise HTTPException(status_code=403 if payload.get("error") == "origin_not_allowed" else 404, detail=payload.get("error"))
    return payload


@app.post("/api/v1/widget/{session_id}/close")
async def widget_close_api(session_id: str, request: Request):
    try:
        raw = await request.body()
        body = json.loads(raw.decode("utf-8")) if raw else {}
    except Exception:
        body = {}
    result = await _get_widget_server().close_session(
        session_id,
        widget_id=str(body.get("widget_id") or "").strip() or None,
    )
    return result


@app.get("/api/v1/knowledge-bases")
async def list_knowledge_bases_api(current_user: UserClaims = Depends(_decode_user)):
    from knowledge_base_manager import get_knowledge_base_manager

    items = get_knowledge_base_manager().list_all(current_user.tenant_id)
    return {"ok": True, "tenant_id": current_user.tenant_id, "items": items, "count": len(items)}


@app.post("/api/v1/knowledge-bases")
async def create_knowledge_base_api(
    body: KnowledgeBaseCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from knowledge_base_manager import get_knowledge_base_manager

    item = await get_knowledge_base_manager().create(body.name, current_user.tenant_id)
    return {"ok": True, "kb": item}


@app.get("/api/v1/knowledge-bases/{kb_id}")
async def get_knowledge_base_api(kb_id: str, current_user: UserClaims = Depends(_decode_user)):
    from knowledge_base_manager import get_knowledge_base_manager

    item = get_knowledge_base_manager().get(kb_id)
    if item is None or str(item.get("tenant_id") or "") != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="knowledge_base_not_found")
    return {"ok": True, "kb": item}


@app.post("/api/v1/knowledge-bases/{kb_id}/upload")
async def upload_knowledge_base_doc_api(
    kb_id: str,
    file: UploadFile = File(...),
    current_user: UserClaims = Depends(_decode_user),
):
    from knowledge_base_manager import get_knowledge_base_manager

    content = await file.read()
    try:
        item = await get_knowledge_base_manager().upload_doc(
            kb_id,
            file.filename or "document.txt",
            content,
            tenant_id=current_user.tenant_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="knowledge_base_not_found") from exc
    return {"ok": True, **item}


@app.post("/api/v1/knowledge-bases/{kb_id}/documents")
async def upload_knowledge_base_document_json_api(
    kb_id: str,
    body: KnowledgeBaseDocumentRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from knowledge_base_manager import get_knowledge_base_manager

    if body.content_base64:
        try:
            file_bytes = base64.b64decode(body.content_base64)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="invalid_base64") from exc
    else:
        file_bytes = str(body.text or "").encode("utf-8")
    try:
        item = await get_knowledge_base_manager().upload_doc(
            kb_id,
            body.filename,
            file_bytes,
            tenant_id=current_user.tenant_id,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="knowledge_base_not_found") from exc
    return {"ok": True, **item}


@app.post("/api/v1/knowledge-bases/{kb_id}/bind/{lobster_id}")
async def bind_knowledge_base_api(
    kb_id: str,
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from knowledge_base_manager import get_knowledge_base_manager

    item = await get_knowledge_base_manager().bind_lobster(kb_id, lobster_id, current_user.tenant_id)
    return {"ok": True, **item}


@app.get("/api/v1/knowledge-bases/{kb_id}/search")
async def search_knowledge_base_api(
    kb_id: str,
    q: str = Query(..., min_length=1, max_length=1000),
    top_k: int = Query(default=5, ge=1, le=20),
    current_user: UserClaims = Depends(_decode_user),
):
    from knowledge_base_manager import get_knowledge_base_manager

    item = get_knowledge_base_manager().get(kb_id)
    if item is None or str(item.get("tenant_id") or "") != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="knowledge_base_not_found")
    hits = get_knowledge_base_manager().search(kb_id, q, top_k=top_k)
    return {"ok": True, "kb_id": kb_id, "items": hits, "count": len(hits)}


@app.post("/api/v1/files/parse")
async def parse_file_api(
    body: FileLoaderTextRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from file_loader import LobsterFileLoader

    if body.content_base64:
        try:
            file_bytes = base64.b64decode(body.content_base64)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="invalid_base64") from exc
    else:
        file_bytes = str(body.text or "").encode("utf-8")
    loaded = await LobsterFileLoader().load(body.filename, file_bytes=file_bytes)
    return {"ok": True, "file": loaded.to_dict()}


@app.post("/api/v1/files/extract-business-card")
async def extract_business_card_api(
    body: FileLoaderTextRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from file_loader import LobsterFileLoader

    if body.content_base64:
        try:
            file_bytes = base64.b64decode(body.content_base64)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="invalid_base64") from exc
    else:
        file_bytes = str(body.text or "").encode("utf-8")
    loader = LobsterFileLoader()
    loaded = await loader.load(body.filename, file_bytes=file_bytes)
    extract = await loader.extract_business_card(loaded)
    return {"ok": True, "file": loaded.to_dict(), "card": extract.to_dict()}


@app.get("/api/v1/mind-map/{tenant_id}/{lead_id}")
async def api_v1_customer_mind_map(
    tenant_id: str,
    lead_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    from customer_mind_map import get_customer_mind_map_store

    mind_map = get_customer_mind_map_store().get_or_create(tenant_id, lead_id)
    return {"ok": True, "mind_map": mind_map.to_dict()}


@app.get("/api/v1/mind-map/{tenant_id}/{lead_id}/questions")
async def api_v1_customer_mind_map_questions(
    tenant_id: str,
    lead_id: str,
    limit: int = Query(default=3, ge=1, le=10),
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    from customer_mind_map import get_customer_mind_map_store

    mind_map = get_customer_mind_map_store().get_or_create(tenant_id, lead_id)
    return {"ok": True, "questions": mind_map.get_next_questions_for_lobster(max_questions=limit)}


@app.get("/api/v1/mind-map/{tenant_id}/{lead_id}/briefing")
async def api_v1_customer_mind_map_briefing(
    tenant_id: str,
    lead_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    from customer_mind_map import get_customer_mind_map_store

    mind_map = get_customer_mind_map_store().get_or_create(tenant_id, lead_id)
    return {"ok": True, "briefing": mind_map.to_susi_briefing()}


@app.post("/api/v1/mind-map/{tenant_id}/{lead_id}/nodes/{dimension}")
async def api_v1_customer_mind_map_update_node(
    tenant_id: str,
    lead_id: str,
    dimension: str,
    body: MindMapNodeUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    from customer_mind_map import get_customer_mind_map_store

    store = get_customer_mind_map_store()
    mind_map = store.get_or_create(tenant_id, lead_id)
    node = mind_map.update_node(
        dimension=dimension,
        new_facts=body.new_facts,
        answered_questions=body.answered_questions,
        source=body.source,
        confidence=body.confidence,
    )
    if node is None:
        raise HTTPException(status_code=404, detail="mind_map_dimension_not_found")
    store.save(mind_map)
    return {"ok": True, "mind_map": mind_map.to_dict(), "updated_node": node.to_dict()}


@app.get("/api/v1/rule-engine/rules")
async def list_rule_engine_rules_api(current_user: UserClaims = Depends(_decode_user)):
    return {"ok": True, "items": _get_lobster_rule_engine().list_rules()}


@app.post("/api/v1/rule-engine/rules")
async def upsert_rule_engine_rule_api(
    body: LobsterRuleUpsertRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    item = _get_lobster_rule_engine().upsert_rule(body.model_dump())
    return {"ok": True, "rule": item}


@app.delete("/api/v1/rule-engine/rules/{rule_id}")
async def delete_rule_engine_rule_api(
    rule_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    deleted = _get_lobster_rule_engine().delete_rule(rule_id)
    return {"ok": True, "deleted": deleted}


@app.post("/api/v1/rule-engine/evaluate")
async def evaluate_rule_engine_api(
    body: RuleEngineEventRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    tenant_id = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    triggered = await _get_lobster_rule_engine().process(body.event, tenant_id)
    return {"ok": True, "tenant_id": tenant_id, "triggered": triggered, "count": len(triggered)}


@app.get("/api/v1/analytics/attribution")
async def analytics_attribution_api(
    model: str = Query(default="u_shape", min_length=1, max_length=32),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    from attribution_engine import AttributionModel, get_attribution_engine

    try:
        normalized_model = AttributionModel(str(model).strip().lower())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid_attribution_model") from exc
    payload = get_attribution_engine().attribute(
        tenant_id=current_user.tenant_id,
        model=normalized_model,
        start=start,
        end=end,
    )
    channel_rollup = payload.get("channel_rollup", [])
    total_credit = sum(float(item.get("credit", 0) or 0) for item in channel_rollup)
    series = [
        {
            "name": str(item.get("key") or ""),
            "label": str(item.get("key") or ""),
            "value": round(float(item.get("credit", 0) or 0), 4),
            "share": round((float(item.get("credit", 0) or 0) / total_credit) * 100, 1) if total_credit > 0 else 0.0,
        }
        for item in channel_rollup
    ]
    top_channel = series[0]["label"] if series else "-"
    lobster_rollup = payload.get("lobster_rollup", [])
    top_lobster = str(lobster_rollup[0].get("key") or "-") if lobster_rollup else "-"
    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "model": normalized_model.value,
        "start": start or "",
        "end": end or "",
        "totals": {
            "run_count": int(payload.get("run_count", 0) or 0),
            "channel_count": len(series),
            "total_credit": round(total_credit, 4),
        },
        "series": series,
        "highlights": [
            {"label": "top_channel", "value": top_channel},
            {"label": "top_lobster", "value": top_lobster},
        ],
        "metadata": {
            "raw": payload,
        },
    }


@app.get("/api/v1/analytics/funnel")
async def analytics_funnel_api(
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    from funnel_analyzer import get_funnel_analyzer

    payload = get_funnel_analyzer().build_funnel(
        tenant_id=current_user.tenant_id,
        start=start,
        end=end,
    )
    stages = [
        {
            "name": str(item.get("step_key") or ""),
            "label": str(item.get("step_name") or ""),
            "value": int(item.get("count", 0) or 0),
            "dropoff": round(float(item.get("drop_off", 0) or 0), 1),
            "conversion_rate": round(float(item.get("conversion_rate", 0) or 0) * 100, 1),
        }
        for item in payload.get("steps", [])
    ]
    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "start": start or "",
        "end": end or "",
        "stages": stages,
        "totals": {
            "primary": stages[0]["value"] if stages else 0,
            "final": stages[-1]["value"] if stages else 0,
            "run_count": int(payload.get("run_count", 0) or 0),
        },
        "metadata": {
            "raw": payload,
        },
    }


@app.get("/api/v1/cost/lobsters")
async def lobster_cost_summary_api(
    range: str = Query(default="7d", pattern="^(1d|7d|30d)$"),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    analyzer = get_lobster_cost_analyzer()
    items = analyzer.get_all_lobsters_summary(current_user.tenant_id, range)
    budget = analyzer.get_tenant_budget_usage(current_user.tenant_id, range)
    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "range": range,
        "items": items,
        "budget": budget,
    }


@app.get("/api/v1/cost/lobsters/{lobster_id}")
async def lobster_cost_detail_api(
    lobster_id: str,
    range: str = Query(default="7d", pattern="^(1d|7d|30d)$"),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    analyzer = get_lobster_cost_analyzer()
    summary = analyzer.get_lobster_summary(current_user.tenant_id, lobster_id, range).to_dict()
    top_calls = analyzer.get_top_cost_calls(current_user.tenant_id, lobster_id, range, limit=10)
    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "range": range,
        "summary": summary,
        "top_calls": top_calls,
    }


@app.get("/api/v1/cost/lobsters/{lobster_id}/timeseries")
async def lobster_cost_timeseries_api(
    lobster_id: str,
    range: str = Query(default="7d", pattern="^(1d|7d|30d)$"),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    analyzer = get_lobster_cost_analyzer()
    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "lobster_id": lobster_id,
        "range": range,
        "data": analyzer.get_timeseries(current_user.tenant_id, lobster_id, range),
    }


@app.post("/api/v1/analytics/nl-query")
async def analytics_nl_query_api(
    body: NLQueryRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from nl_query_engine import get_nl_query_engine

    tenant_id = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    question = str(body.question or body.query or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="question_or_query_required")
    payload = get_nl_query_engine().analyze(question, tenant_id)
    return {
        "ok": True,
        "tenant_id": tenant_id,
        "answer": str(payload.get("summary") or ""),
        "metadata": {
            "plan": payload.get("plan", {}),
            "data": payload.get("data", {}),
        },
    }


@app.get("/api/v1/surveys")
async def list_surveys_api(current_user: UserClaims = Depends(_decode_user)):
    from survey_engine import get_survey_engine

    items = [
        {
            **item,
            "name": item.get("title"),
            "description": item.get("trigger_event"),
        }
        for item in get_survey_engine().list_surveys()
    ]
    return {"ok": True, "count": len(items), "surveys": items}


@app.post("/api/v1/surveys")
async def create_survey_api(
    body: SurveyCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from survey_engine import get_survey_engine

    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    survey = get_survey_engine().create_survey(body.model_dump())
    survey = {**survey, "name": survey.get("title"), "description": survey.get("trigger_event")}
    return {"ok": True, "survey_id": survey.get("survey_id"), "survey": survey}


@app.get("/api/v1/surveys/{survey_id}/results")
async def survey_results_api(
    survey_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from survey_engine import get_survey_engine

    payload = get_survey_engine().get_results(survey_id, tenant_id=current_user.tenant_id)
    return {"ok": True, "survey_id": survey_id, "results": payload.get("items", []), "metadata": payload}


@app.post("/api/v1/surveys/respond")
async def survey_respond_api(
    body: SurveyRespondRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from survey_engine import SurveyResponse, get_survey_engine

    result = await get_survey_engine().record_response(
        SurveyResponse(
            survey_id=body.survey_id,
            tenant_id=current_user.tenant_id,
            respondent_id=str(body.respondent_id or current_user.sub).strip() or current_user.sub,
            answers=body.answers,
            lobster_task_id=body.lobster_task_id,
        )
    )
    return {
        "ok": True,
        "submitted_at": _utc_now(),
        "result": {
            "survey_id": body.survey_id,
            "answers": body.answers,
            "submitted_at": _utc_now(),
            "respondent": str(body.respondent_id or current_user.sub).strip() or current_user.sub,
            "score": result.get("score"),
        },
    }


@app.get("/api/v1/providers")
async def list_providers(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    registry = get_provider_registry()
    return {
        "ok": True,
        "providers": registry.list_provider_configs(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/v1/providers")
async def create_provider(body: ProviderCreateRequest, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    registry = get_provider_registry()
    try:
        provider = await registry.add_provider(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="provider_registry.create",
        event_type="created",
        payload={"provider_id": body.id},
        level="warning",
    )
    return {"ok": True, "provider": provider}


@app.put("/api/v1/providers/{provider_id}")
async def update_provider(
    provider_id: str,
    body: ProviderUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    registry = get_provider_registry()
    try:
        provider = await registry.update_provider(
            provider_id,
            {
                key: value
                for key, value in body.model_dump().items()
                if value is not None
            },
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="provider_not_found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="provider_registry.update",
        event_type="updated",
        payload={"provider_id": provider_id},
        level="warning",
    )
    return {"ok": True, "provider": provider}


@app.delete("/api/v1/providers/{provider_id}")
async def delete_provider(provider_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    deleted = await get_provider_registry().remove_provider(provider_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="provider_not_found")
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="provider_registry.delete",
        event_type="deleted",
        payload={"provider_id": provider_id},
        level="warning",
    )
    return {"ok": True, "deleted": True}


@app.post("/api/v1/providers/{provider_id}/reload")
async def reload_provider_api(provider_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    reloaded = await get_provider_registry().reload_provider(provider_id)
    if not reloaded:
        raise HTTPException(status_code=404, detail="provider_not_found")
    return {"ok": True, "provider_id": provider_id, "reloaded": True}


@app.post("/api/v1/providers/{provider_id}/smoke")
async def smoke_provider_api(
    provider_id: str,
    body: ProviderSmokeRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    registry = get_provider_registry()
    try:
        result = await registry.smoke_provider(provider_id, prompt=body.prompt)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="provider_not_found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@app.get("/api/v1/providers/{provider_id}/metrics")
async def provider_metrics_api(provider_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    registry = get_provider_registry()
    try:
        metrics = registry.get_provider_metrics(provider_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="provider_not_found") from exc
    return {"ok": True, "metrics": metrics}


@app.get("/api/v1/mcp/servers")
async def list_mcp_servers(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "servers": get_mcp_gateway().list_servers()}


@app.post("/api/v1/mcp/servers")
async def register_mcp_server(body: MCPServerRequest, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    gateway = get_mcp_gateway()
    gateway.register_server(
        MCPServerConfig(
            id=body.id,
            name=body.name,
            transport=body.transport,
            command=body.command,
            url=body.url,
            env={str(k): str(v) for k, v in body.env.items()},
            enabled=body.enabled,
            allowed_lobsters=[str(item).strip() for item in body.allowed_lobsters if str(item).strip()],
            edge_node_id=str(body.edge_node_id or "").strip() or None,
        )
    )
    return {"ok": True, "server": gateway.list_servers()[-1]}


@app.delete("/api/v1/mcp/servers/{server_id}")
async def delete_mcp_server(server_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    gateway = get_mcp_gateway()
    gateway.unregister_server(server_id)
    return {"ok": True, "deleted": True}


@app.put("/api/v1/mcp/servers/{server_id}")
async def update_mcp_server(
    server_id: str,
    body: MCPServerUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    gateway = get_mcp_gateway()
    updated = gateway.update_server(
        server_id,
        {
            key: value
            for key, value in body.model_dump().items()
            if value is not None
        },
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="mcp_server_not_found")
    return {"ok": True, "server": updated.to_dict(redact_env=True)}


@app.get("/api/v1/mcp/servers/{server_id}/tools")
async def discover_mcp_tools(server_id: str, current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {"ok": True, "tools": await get_mcp_gateway().discover_tools(server_id)}


@app.post("/api/v1/mcp/servers/{server_id}/ping")
async def ping_mcp_server(server_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    healthy = await get_mcp_gateway().health_check(server_id)
    return {"ok": True, "server_id": server_id, "healthy": healthy}


@app.post("/api/v1/mcp/call")
async def call_mcp_tool(body: MCPCallRequest, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    result = await get_mcp_gateway().call_tool(
        body.server_id,
        body.tool_name,
        body.args,
        body.lobster_id,
        tenant_id=current_user.tenant_id,
        session_id=str(body.session_id or "").strip(),
    )
    return result


@app.get("/api/v1/mcp/call/history")
async def mcp_call_history(
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "items": get_mcp_gateway().list_call_history(limit=limit, tenant_id=current_user.tenant_id)}


@app.get("/api/v1/monitor/tools/top")
async def monitor_top_tools(
    limit: int = Query(default=10, ge=1, le=50),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "items": get_mcp_gateway().get_monitor_top_tools(limit=limit, tenant_id=current_user.tenant_id)}


@app.get("/api/v1/monitor/tools/heatmap")
async def monitor_tool_heatmap(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "items": get_mcp_gateway().get_monitor_heatmap(tenant_id=current_user.tenant_id)}


@app.get("/api/v1/monitor/tools/failures")
async def monitor_tool_failures(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "items": get_mcp_gateway().get_monitor_failures(tenant_id=current_user.tenant_id)}


@app.get("/api/v1/monitor/tools/recent")
async def monitor_tool_recent(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "items": get_mcp_gateway().get_monitor_recent(limit=limit, tenant_id=current_user.tenant_id)}


@app.get("/api/v1/mcp/policies")
async def list_mcp_tool_policies(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from mcp_tool_policy import tool_policy_enforcer

    return {"ok": True, "items": tool_policy_enforcer.list_policies()}


@app.put("/api/v1/mcp/policies/{lobster_name}")
async def update_mcp_tool_policy(
    lobster_name: str,
    body: McpToolPolicyUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from mcp_tool_policy import tool_policy_enforcer

    updated = tool_policy_enforcer.update_policy_override(lobster_name, body.model_dump())
    return {"ok": True, "policy": updated}


@app.get("/api/v1/tools/marketplace")
async def list_tool_marketplace(
    category: str | None = None,
    tag: str | None = None,
    current_user: UserClaims = Depends(_decode_user),
):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from tool_marketplace import get_tool_marketplace

    return {
        "ok": True,
        "items": get_tool_marketplace().list_all(
            category=str(category or "").strip() or None,
            tag=str(tag or "").strip() or None,
            tenant_id=current_user.tenant_id,
        ),
    }


@app.get("/api/v1/tools/subscriptions")
async def list_tool_subscriptions(current_user: UserClaims = Depends(_decode_user)):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from tool_marketplace import get_tool_marketplace

    return {"ok": True, "items": get_tool_marketplace().list_subscriptions(current_user.tenant_id)}


@app.post("/api/v1/tools/marketplace")
async def publish_marketplace_tool(
    body: ToolListingRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    from tool_marketplace import ToolListing
    from tool_marketplace import get_tool_marketplace

    listing = ToolListing(
        tool_id=body.tool_id,
        name=body.name,
        description=body.description,
        category=body.category,
        icon=body.icon,
        mcp_endpoint=body.mcp_endpoint,
        version=body.version,
        author=body.author,
        is_builtin=body.is_builtin,
        is_active=body.is_active,
        monthly_cost_usd=body.monthly_cost_usd,
        tags=[str(item).strip() for item in body.tags if str(item).strip()],
    )
    get_tool_marketplace().publish(listing)
    return {"ok": True, "item": listing.to_dict()}


@app.post("/api/v1/tools/subscribe")
async def subscribe_marketplace_tool(
    body: ToolSubscriptionRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from tool_marketplace import get_tool_marketplace

    target_tenant = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden")
    ok = get_tool_marketplace().subscribe(target_tenant, body.tool_id)
    if not ok:
        raise HTTPException(status_code=404, detail="tool_not_found")
    return {"ok": True, "tenant_id": target_tenant, "tool_id": body.tool_id}


@app.post("/api/v1/tools/unsubscribe")
async def unsubscribe_marketplace_tool(
    body: ToolSubscriptionRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if not current_user.sub:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from tool_marketplace import get_tool_marketplace

    target_tenant = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden")
    get_tool_marketplace().unsubscribe(target_tenant, body.tool_id)
    return {"ok": True, "tenant_id": target_tenant, "tool_id": body.tool_id}


@app.get("/llm/router/metrics")
async def llm_router_metrics(
    reset: bool = Query(default=False),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "metrics": llm_router.snapshot_metrics(reset=reset)}


@app.post("/llm/router/smoke")
async def llm_router_smoke(
    body: LlmSmokeRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")

    effective_user_id = body.user_id or current_user.sub
    before = llm_router.snapshot_metrics()
    before_backend_usage = dict(before.get("backend_usage", {}) or {})
    before_cloud_success = int(before.get("calls_success_cloud", 0) or 0)

    content = await llm_router.routed_ainvoke_text(
        system_prompt="你是路由连通性测试助手，仅返回一句自然语言。",
        user_prompt=body.prompt,
        meta=RouteMeta(
            critical=bool(body.force_cloud),
            est_tokens=512,
            tenant_tier=body.tenant_tier,
            user_id=effective_user_id,
            tenant_id=current_user.tenant_id,
            task_type=body.task_type,
            force_tier=body.force_tier,
        ),
        temperature=0.0,
        force_tier=body.force_tier,
    )

    after = llm_router.snapshot_metrics()
    after_backend_usage = dict(after.get("backend_usage", {}) or {})
    backend_delta: dict[str, int] = {}
    for key in sorted(set(before_backend_usage) | set(after_backend_usage)):
        delta = int(after_backend_usage.get(key, 0) or 0) - int(before_backend_usage.get(key, 0) or 0)
        if delta != 0:
            backend_delta[key] = delta

    cloud_success_delta = int(after.get("calls_success_cloud", 0) or 0) - before_cloud_success
    if body.force_cloud and cloud_success_delta <= 0:
        raise HTTPException(
            status_code=502,
            detail={
                "message": "LLM cloud smoke expected cloud success but no cloud call succeeded",
                "backend_delta": backend_delta,
                "router": llm_router.describe(),
            },
        )

    return {
        "ok": True,
        "force_cloud": body.force_cloud,
        "force_tier": body.force_tier,
        "response": content[:2000],
        "backend_delta": backend_delta,
        "cloud_success_delta": cloud_success_delta,
        "router": llm_router.describe(),
        "smart_routing": llm_router.snapshot_metrics().get("last_smart_routing"),
    }


@app.get("/llm/model/catalog")
async def llm_model_registry_catalog(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "catalog": llm_model_catalog()}


@app.get("/llm/providers")
async def llm_provider_configs(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    rows = list_llm_provider_configs(tenant_id=target_tenant)
    return {"ok": True, "tenant_id": target_tenant, "providers": rows}


@app.put("/llm/providers/{provider_id}")
async def llm_provider_config_update(
    provider_id: str,
    body: LlmProviderConfigUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(body.tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    source_provider = str(provider_id).strip().lower()
    if not source_provider:
        raise HTTPException(status_code=400, detail="provider_id is required")
    row = upsert_llm_provider_config(
        tenant_id=target_tenant,
        provider_id=source_provider,
        enabled=body.enabled,
        route=body.route,
        base_url=body.base_url,
        default_model=body.default_model,
        api_key=body.api_key,
        note=body.note,
        updated_by=current_user.sub,
    )
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="llm.provider.update",
        event_type="updated",
        payload={"tenant_id": target_tenant, "provider_id": source_provider},
        level="warning",
    )
    return {"ok": True, "tenant_id": target_tenant, "provider": row}


@app.get("/llm/agent-bindings")
async def llm_agent_bindings(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    rows = list_agent_model_bindings(tenant_id=target_tenant)
    return {"ok": True, "tenant_id": target_tenant, "bindings": rows}


@app.put("/llm/agent-bindings/{agent_id}")
async def llm_agent_binding_update(
    agent_id: str,
    body: LlmAgentBindingUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(body.tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    source_agent = str(agent_id).strip().lower()
    if not source_agent:
        raise HTTPException(status_code=400, detail="agent_id is required")
    row = upsert_agent_model_binding(
        tenant_id=target_tenant,
        agent_id=source_agent,
        enabled=body.enabled,
        task_type=body.task_type,
        provider_id=body.provider_id,
        model_name=body.model_name,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
        note=body.note,
        updated_by=current_user.sub,
    )
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="llm.agent_binding.update",
        event_type="updated",
        payload={"tenant_id": target_tenant, "agent_id": source_agent},
        level="warning",
    )
    return {"ok": True, "tenant_id": target_tenant, "binding": row}


@app.get("/agent/extensions")
async def agent_extension_profiles(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    profiles = list_agent_extension_profiles(tenant_id=target_tenant)
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "profiles": profiles,
        "catalog": agent_extension_catalog(),
    }


@app.get("/agent/extensions/{agent_id}")
async def agent_extension_profile_detail(
    agent_id: str,
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    source_agent = str(agent_id).strip().lower()
    if not source_agent:
        raise HTTPException(status_code=400, detail="agent_id is required")
    if source_agent not in set(extension_agent_ids):
        raise HTTPException(status_code=400, detail="unsupported agent_id")
    profile = get_agent_extension_profile(tenant_id=target_tenant, agent_id=source_agent)
    return {"ok": True, "tenant_id": target_tenant, "profile": profile}


@app.put("/agent/extensions/{agent_id}")
async def agent_extension_profile_upsert(
    agent_id: str,
    body: AgentExtensionProfileUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(body.tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    source_agent = str(agent_id).strip().lower()
    if not source_agent:
        raise HTTPException(status_code=400, detail="agent_id is required")
    if source_agent not in set(extension_agent_ids):
        raise HTTPException(status_code=400, detail="unsupported agent_id")

    profile = upsert_agent_extension_profile(
        tenant_id=target_tenant,
        agent_id=source_agent,
        enabled=body.enabled,
        profile_version=body.profile_version,
        runtime_mode=body.runtime_mode,
        role_prompt=body.role_prompt,
        skills=body.skills,
        nodes=body.nodes,
        hooks=body.hooks,
        limits=body.limits,
        tags=body.tags,
        updated_by=current_user.sub,
    )
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="agent.extension.update",
        event_type="updated",
        payload={
            "tenant_id": target_tenant,
            "agent_id": source_agent,
            "skills_count": len(profile.get("skills", [])),
            "nodes_count": len(profile.get("nodes", [])),
            "profile_version": profile.get("profile_version"),
        },
        level="warning",
    )
    return {"ok": True, "tenant_id": target_tenant, "profile": profile}


@app.get("/skills-pool/overview")
async def skill_pool_overview(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")

    profiles = list_agent_extension_profiles(tenant_id=target_tenant)
    llm_bindings = list_agent_model_bindings(tenant_id=target_tenant)
    llm_providers = list_llm_provider_configs(tenant_id=target_tenant)
    kb_profiles = industry_kb_list_profiles(tenant_id=target_tenant, include_archived=True)
    kb_stats = [industry_kb_profile_stats(tenant_id=target_tenant, industry_tag=str(row.get("industry_tag", ""))) for row in kb_profiles]
    rag_pack_summary = agent_rag_summary_by_agent(tenant_id=target_tenant, profile="feedback")
    rag_pack_total = sum(int(row.get("pack_count", 0) or 0) for row in rag_pack_summary)
    workflow_templates = registry_list_templates()
    kb_metrics = industry_kb_metrics_dashboard(tenant_id=target_tenant)

    templates_by_industry: dict[str, int] = {}
    for row in workflow_templates:
        industry = str(row.get("industry", "general")).strip().lower() or "general"
        templates_by_industry[industry] = templates_by_industry.get(industry, 0) + 1

    profile_summary = []
    for row in profiles:
        profile_summary.append(
            {
                "agent_id": str(row.get("agent_id", "")),
                "enabled": bool(row.get("enabled", True)),
                "profile_version": str(row.get("profile_version", "")),
                "runtime_mode": str(row.get("runtime_mode", "hybrid")),
                "skills_count": len(row.get("skills", [])),
                "nodes_count": len(row.get("nodes", [])),
                "updated_at": row.get("updated_at"),
            }
        )

    return {
        "ok": True,
        "tenant_id": target_tenant,
        "overview": {
            "summary": {
                "agents_total": len(profile_summary),
                "agents_enabled": sum(1 for row in profile_summary if row.get("enabled")),
                "skills_total": sum(int(row.get("skills_count", 0) or 0) for row in profile_summary),
                "nodes_total": sum(int(row.get("nodes_count", 0) or 0) for row in profile_summary),
                "kb_profiles_total": len(kb_profiles),
                "rag_packs_total": int(rag_pack_total),
                "workflow_templates_total": len(workflow_templates),
            },
            "profiles": profile_summary,
            "agent_profiles": profiles,
            "catalog": agent_extension_catalog(),
            "llm_bindings": llm_bindings,
            "llm_providers": llm_providers,
            "industry_kb_profiles": kb_profiles,
            "industry_kb_stats": kb_stats,
            "industry_kb_metrics": kb_metrics,
            "agent_rag_pack_summary": rag_pack_summary,
            "workflow_templates": workflow_templates,
            "workflow_templates_by_industry": templates_by_industry,
        },
    }


@app.post("/research/signals/refresh")
async def research_signals_refresh(
    body: ResearchRefreshRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    sources = [str(x).strip() for x in body.sources if str(x).strip()] or _research_sources_default()
    run = research_begin_fetch_run(
        tenant_id=effective_tenant,
        trigger_type=body.trigger_type,
        requested_sources=sources,
    )
    success_count = 0
    fail_count = 0
    errors: list[str] = []
    for source in sources:
        fetch_result = _research_fetch_with_retry(source)
        if fetch_result["ok"]:
            rows = fetch_result["rows"]
            for item in rows:
                _research_upsert_auto_row(tenant_id=effective_tenant, item=item)
                success_count += 1
            research_record_source_health(
                tenant_id=effective_tenant,
                source=source,
                run_id=str(run.get("run_id")),
                status="success",
                item_count=len(rows),
                duration_ms=int(fetch_result["duration_ms"]),
            )
        else:
            fail_count += 1
            errors.append(f"{source}: {fetch_result['error']}")
            research_record_source_health(
                tenant_id=effective_tenant,
                source=source,
                run_id=str(run.get("run_id")),
                status="failed",
                item_count=0,
                duration_ms=int(fetch_result["duration_ms"]),
                error_message=str(fetch_result["error"]),
            )
    research_finish_fetch_run(
        run_id=str(run.get("run_id")),
        success_count=success_count,
        fail_count=fail_count,
        error_summary="; ".join(errors[:10]),
    )
    return {
        "ok": True,
        "tenant_id": effective_tenant,
        "run_id": run.get("run_id"),
        "sources": sources,
        "success_count": success_count,
        "fail_count": fail_count,
        "errors": errors[:10],
    }


@app.get("/research/source-health")
async def research_source_health(
    tenant_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    window_hours: int = Query(default=24, ge=1, le=720),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    return {
        "ok": True,
        "tenant_id": effective_tenant,
        "items": research_list_source_health(tenant_id=effective_tenant, limit=limit),
        "slo": research_run_health_summary(tenant_id=effective_tenant, window_hours=window_hours),
    }


@app.post("/research/signals/ingest-manual")
async def research_signals_ingest_manual(
    body: ResearchIngestManualRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    if not body.signals:
        raise HTTPException(status_code=400, detail="signals cannot be empty")
    inserted = 0
    updated = 0
    for item in body.signals:
        row = _research_upsert_manual_row(tenant_id=effective_tenant, item=item)
        if row.get("inserted"):
            inserted += 1
        else:
            updated += 1
    return {"ok": True, "tenant_id": effective_tenant, "inserted": inserted, "updated": updated}


@app.get("/research/signals")
async def research_signals_list(
    tenant_id: str | None = Query(default=None),
    source: str | None = Query(default=None),
    rank_type: str | None = Query(default=None),
    only_executable: bool = Query(default=False),
    limit: int = Query(default=20, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    items = research_list_signals(
        tenant_id=effective_tenant,
        source=source,
        rank_type=rank_type,
        limit=limit,
        only_executable=only_executable,
    )
    return {"ok": True, "tenant_id": effective_tenant, "count": len(items), "items": items}


@app.post("/research/digest/feishu")
async def research_digest_feishu(
    body: ResearchDigestFeishuRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    items = research_list_signals(
        tenant_id=effective_tenant,
        source=body.source,
        rank_type=body.rank_type,
        limit=body.limit,
        only_executable=body.only_executable,
    )
    digest = _render_research_digest_markdown(items, effective_tenant)

    adapter = getattr(app.state, "feishu_channel", feishu_channel)
    chat_id = str(body.chat_id or "research_digest")
    client = getattr(app.state, "http_client", None)
    sent = await adapter.reply(chat_id=chat_id, text=digest, client=client)

    return {
        "ok": True,
        "tenant_id": effective_tenant,
        "count": len(items),
        "sent": sent,
        "digest_preview": digest[:1200],
    }


def _read_optional_text(path: str | None) -> str:
    target = str(path or "").strip()
    if not target:
        return ""
    file_path = Path(target)
    if not file_path.exists() or not file_path.is_file():
        return ""
    try:
        return file_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return file_path.read_text(encoding="gbk", errors="ignore")
    except Exception:  # noqa: BLE001
        return ""


@app.get("/industry-kb/taxonomy")
async def industry_kb_taxonomy(
    current_user: UserClaims = Depends(_decode_user),
):
    taxonomy = taxonomy_list_industry_taxonomy()
    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "category_count": len(taxonomy),
        "taxonomy": taxonomy,
    }


@app.post("/industry-kb/bootstrap")
async def industry_kb_bootstrap(
    body: IndustryKbBootstrapRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")

    seeds = taxonomy_bootstrap_profile_seeds()
    selected = (
        industry_kb_normalize_tag(taxonomy_resolve_subindustry_tag(body.selected_industry_tag))
        if body.selected_industry_tag
        else ""
    )
    if selected:
        seeds = [seed for seed in seeds if str(seed.get("industry_tag", "")).strip() == selected]

    existing = industry_kb_list_profiles(tenant_id=effective_tenant, include_archived=True)
    existing_tags = {str(row.get("industry_tag", "")).strip() for row in existing}
    saved_profiles: list[dict[str, Any]] = []

    for seed in seeds:
        tag = str(seed.get("industry_tag", "")).strip()
        if not tag:
            continue
        if not body.force and tag in existing_tags:
            continue
        saved = industry_kb_upsert_profile(
            tenant_id=effective_tenant,
            industry_tag=tag,
            display_name=str(seed.get("display_name", "")) or None,
            description=str(seed.get("description", "")) or None,
            status="active",
            config=dict(seed.get("config", {}) or {}),
        )
        saved_profiles.append(saved)

    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="industry_kb.bootstrap",
        event_type="bootstrap",
        payload={
            "tenant_id": effective_tenant,
            "saved_count": len(saved_profiles),
            "force": body.force,
            "selected_industry_tag": selected or None,
        },
        level="info",
    )
    return {
        "ok": True,
        "tenant_id": effective_tenant,
        "saved_count": len(saved_profiles),
        "saved_profiles": saved_profiles,
    }


@app.post("/industry-kb/starter-kit/generate")
async def industry_starter_kit_generate(
    body: IndustryStarterKitGenerateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")

    result = industry_generate_starter_tasks(
        tenant_id=effective_tenant,
        industry_tag=body.industry_tag,
        actor_user_id=current_user.sub,
        force=body.force,
        max_tasks=body.max_tasks,
    )
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="industry_starter_kit.generate",
        event_type="starter_tasks_generated",
        payload={
            "tenant_id": effective_tenant,
            "industry_tag": result.get("industry_tag"),
            "accepted_count": result.get("accepted_count"),
            "rejected_count": result.get("rejected_count"),
        },
        level="info",
    )
    return {"ok": True, **result}


@app.get("/industry-kb/starter-kit/tasks")
async def industry_starter_kit_tasks(
    industry_tag: str = Query(..., min_length=1, max_length=64),
    tenant_id: str | None = Query(default=None),
    status: str | None = Query(default="accepted"),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")

    items = industry_list_starter_tasks(
        tenant_id=effective_tenant,
        industry_tag=industry_tag,
        status=status,
        limit=limit,
    )
    return {
        "ok": True,
        "tenant_id": effective_tenant,
        "industry_tag": industry_tag,
        "count": len(items),
        "items": items,
    }


@app.post("/industry-kb/generate-profile")
async def industry_kb_generate_profile(
    body: IndustryKbGenerateProfileRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")

    seed = taxonomy_profile_seed_from_tag(body.industry_tag)
    resolved_tag = str(seed.get("industry_tag") or body.industry_tag).strip()
    seed_cfg = dict(seed.get("config", {}) or {})
    resolved_name = (
        str(body.industry_name or "").strip()
        or str(seed_cfg.get("industry_name") or "").strip()
        or resolved_tag
    )
    if not resolved_tag:
        raise HTTPException(status_code=400, detail="invalid industry_tag")

    base_profile = dict(body.base_profile or {})
    if not base_profile and body.base_profile_json_path:
        loaded = industry_kb_load_json_profile(body.base_profile_json_path)
        if isinstance(loaded, dict):
            base_profile = loaded
    if not base_profile:
        base_profile = deepcopy(industry_kb_default_base_profile)
    base_profile = industry_kb_normalize_profile(base_profile)

    system_prompt_path = str(body.system_prompt_path or "").strip() or DEFAULT_INDUSTRY_KB_PROMPT_PATH
    system_prompt_text = _read_optional_text(system_prompt_path)
    trace_id = str(body.trace_id or f"industry_profile_{uuid.uuid4().hex[:12]}")
    generated = await industry_kb_generate_profile_with_retry(
        industry_name=resolved_name,
        tenant_id=effective_tenant,
        user_id=current_user.sub,
        base_profile=base_profile,
        system_prompt_template=system_prompt_text,
        max_retries=body.max_retries,
    )
    if not bool(generated.get("ok")):
        detail = {
            "error": "industry_profile_generation_failed",
            "industry_tag": resolved_tag,
            "industry_name": resolved_name,
            "attempt": int(generated.get("attempt", body.max_retries) or body.max_retries),
            "reason": str(generated.get("error") or "unknown_error"),
        }
        _remember_event(
            user_id=current_user.sub,
            trace_id=trace_id,
            node="industry_kb.generate_profile",
            event_type="failed",
            payload=detail,
            level="error",
        )
        raise HTTPException(status_code=422, detail=detail)

    profile = dict(generated.get("profile") or {})
    saved_profile: dict[str, Any] | None = None
    ingest_result: dict[str, Any] | None = None

    if body.seed_to_kb:
        merged_config = dict(seed_cfg)
        merged_config["structured_profile"] = profile
        merged_config["generated_by"] = "llm_router"
        merged_config["generated_at"] = datetime.now(timezone.utc).isoformat()
        merged_config["generation_attempt"] = int(generated.get("attempt", 1) or 1)

        saved_profile = industry_kb_upsert_profile(
            tenant_id=effective_tenant,
            industry_tag=resolved_tag,
            display_name=str(seed.get("display_name") or f"{resolved_name}知识库"),
            description=str(seed.get("description") or f"{resolved_name}专属知识资产"),
            status="active",
            config=merged_config,
        )

        entries = industry_kb_profile_to_entries(profile, prompt_text=system_prompt_text)
        ingest_result = industry_kb_ingest_entries(
            tenant_id=effective_tenant,
            industry_tag=resolved_tag,
            entries=entries,
            trace_id=trace_id,
            actor_user_id=current_user.sub,
        )

    _remember_event(
        user_id=current_user.sub,
        trace_id=trace_id,
        node="industry_kb.generate_profile",
        event_type="generated",
        payload={
            "tenant_id": effective_tenant,
            "industry_tag": resolved_tag,
            "industry_name": resolved_name,
            "attempt": int(generated.get("attempt", 1) or 1),
            "seed_to_kb": body.seed_to_kb,
            "system_prompt_path": system_prompt_path,
            "ingested_count": int((ingest_result or {}).get("ingested_count", 0) or 0),
            "duplicate_count": int((ingest_result or {}).get("duplicate_count", 0) or 0),
            "rejected_count": int((ingest_result or {}).get("rejected_count", 0) or 0),
        },
        level="warning" if int((ingest_result or {}).get("rejected_count", 0) or 0) > 0 else "info",
    )
    return {
        "ok": True,
        "tenant_id": effective_tenant,
        "industry_tag": resolved_tag,
        "industry_name": resolved_name,
        "trace_id": trace_id,
        "attempt": int(generated.get("attempt", 1) or 1),
        "system_prompt_path": system_prompt_path,
        "generated_profile": profile,
        "profile_saved": saved_profile,
        "ingest_result": ingest_result,
    }


@app.post("/industry-kb/bulk-seed")
async def industry_kb_bulk_seed(
    body: IndustryKbBulkSeedRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")

    actor_user_id = str(body.actor_user_id or current_user.sub).strip() or current_user.sub
    if actor_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="actor_user_id mismatch with login user")

    base_profile = dict(body.base_profile or {})
    if not base_profile and body.base_profile_json_path:
        loaded = industry_kb_load_json_profile(body.base_profile_json_path)
        if isinstance(loaded, dict):
            base_profile = loaded
    if not base_profile:
        base_profile = deepcopy(industry_kb_default_base_profile)
    base_profile = industry_kb_normalize_profile(base_profile)

    selected_tags: list[str] = []
    for item in body.selected_industry_tags:
        tag = industry_kb_normalize_tag(taxonomy_resolve_subindustry_tag(item))
        if tag and tag not in selected_tags:
            selected_tags.append(tag)

    prompt_template_path = str(body.prompt_template_path or "").strip() or DEFAULT_INDUSTRY_KB_PROMPT_PATH
    row = industry_kb_seed_all_subindustries(
        tenant_id=effective_tenant,
        actor_user_id=actor_user_id,
        base_profile=base_profile,
        prompt_template_path=prompt_template_path,
        selected_tags=selected_tags or None,
    )
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="industry_kb.bulk_seed",
        event_type="seeded",
        payload={
            "tenant_id": effective_tenant,
            "industry_count": int(row.get("industry_count", 0) or 0),
            "total_ingested": int(row.get("total_ingested", 0) or 0),
            "total_rejected": int(row.get("total_rejected", 0) or 0),
            "total_duplicates": int(row.get("total_duplicates", 0) or 0),
            "selected_tags": selected_tags,
            "prompt_template_path": prompt_template_path,
        },
        level="warning" if int(row.get("total_rejected", 0) or 0) > 0 else "info",
    )
    return row


@app.put("/industry-kb/profile")
async def industry_kb_profile_upsert(
    body: IndustryKbProfileUpsertRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    seed = taxonomy_profile_seed_from_tag(body.industry_tag)
    merged_config = dict(seed.get("config", {}) or {})
    merged_config.update(dict(body.config or {}))
    saved = industry_kb_upsert_profile(
        tenant_id=effective_tenant,
        industry_tag=str(seed.get("industry_tag", body.industry_tag)),
        display_name=body.display_name or str(seed.get("display_name", "")),
        description=body.description or str(seed.get("description", "")),
        status=body.status,
        config=merged_config,
    )
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="industry_kb.profile",
        event_type="upsert",
        payload={"tenant_id": effective_tenant, "industry_tag": saved.get("industry_tag")},
        level="info",
    )
    return {"ok": True, "profile": saved}


@app.get("/industry-kb/profiles")
async def industry_kb_profiles(
    tenant_id: str | None = Query(default=None),
    include_archived: bool = Query(default=False),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    rows = industry_kb_list_profiles(tenant_id=effective_tenant, include_archived=include_archived)
    return {"ok": True, "tenant_id": effective_tenant, "count": len(rows), "profiles": rows}


@app.post("/industry-kb/ingest")
async def industry_kb_ingest(
    body: IndustryKbIngestRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    entries = [item.model_dump() for item in body.entries]
    row = industry_kb_ingest_entries(
        tenant_id=effective_tenant,
        industry_tag=body.industry_tag,
        entries=entries,
        trace_id=body.trace_id,
        actor_user_id=current_user.sub,
    )
    _remember_event(
        user_id=current_user.sub,
        trace_id=body.trace_id,
        node="industry_kb.ingest",
        event_type="ingest",
        payload={
            "tenant_id": effective_tenant,
            "industry_tag": row.get("industry_tag"),
            "ingested_count": row.get("ingested_count"),
            "accepted_count": row.get("accepted_count"),
            "duplicate_count": row.get("duplicate_count"),
            "rejected_count": row.get("rejected_count"),
            "vector_count": row.get("vector_count"),
            "thresholds": row.get("thresholds", {}),
            "rejected_samples": row.get("rejected_samples", []),
        },
        level="warning" if int(row.get("rejected_count", 0) or 0) > 0 else "info",
    )
    return row


@app.post("/industry-kb/dissect-and-ingest", response_model=IndustryKbDissectIngestResponse)
async def industry_kb_dissect_and_ingest(
    body: IndustryKbDissectIngestRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = body.user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="user_id mismatch with login user")
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")

    accounts = _normalize_competitor_accounts(body.competitor_accounts)
    if not accounts:
        raise HTTPException(status_code=400, detail="competitor_accounts is required")

    industry_tag = _resolve_industry_tag_for_task(
        task_description=f"industry dissect {body.industry_tag or ''}",
        competitor_handles=accounts,
        industry_tag_hint=body.industry_tag,
    )
    _ensure_industry_profile_seed(
        tenant_id=effective_tenant,
        industry_tag=industry_tag,
        actor_user_id=effective_user_id,
    )
    trace_id = str(uuid.uuid4())
    thread_id = f"{effective_user_id}_industry_dissect"

    _remember_event(
        user_id=effective_user_id,
        trace_id=trace_id,
        node="api.industry_kb_dissect_and_ingest",
        event_type="request_started",
        payload={
            "industry_tag": industry_tag,
            "competitor_accounts": accounts,
            "account_count": len(accounts),
            "account_dissect_node": "competitor_analysis -> competitor_formula_analyzer",
        },
        level="info",
    )

    try:
        dissect_state: dict[str, Any] = {
            "trace_id": trace_id,
            "task_description": f"Dissect benchmark accounts for {industry_tag}",
            "user_id": effective_user_id,
            "tenant_id": effective_tenant,
            "industry_tag": industry_tag,
            "competitor_handles": accounts,
            "target_account_url": accounts[0],
            "analysis_mode": True,
            "radar_data": {"keywords": [industry_tag], "platforms": ["xiaohongshu", "douyin"]},
            "hot_topics": [f"{industry_tag}_conversion", f"{industry_tag}_ugc", f"{industry_tag}_dm_closure"],
        }
        dissect_row = await dragon_competitor_analysis_node(dissect_state)  # account_dissect_node
        dissect_state.update(dissect_row or {})
        formula_row = await dragon_competitor_formula_analyzer_node(dissect_state)
        dissect_state.update(formula_row or {})

        formulas = (
            dissect_state.get("competitor_formulas", [])
            if isinstance(dissect_state.get("competitor_formulas"), list)
            else []
        )
        call_log = []
        if isinstance(dissect_row.get("call_log"), list):
            call_log.extend(dissect_row.get("call_log", []))
        if isinstance(formula_row.get("call_log"), list):
            call_log.extend(formula_row.get("call_log", []))

        formula_ingest = industry_kb_ingest_competitor_formulas(
            tenant_id=effective_tenant,
            industry_tag=industry_tag,
            formulas=formulas,
            source_account=",".join(accounts)[:120],
            trace_id=trace_id,
            actor_user_id=effective_user_id,
        )

        startup_playbooks = [_to_startup_playbook(formula, industry_tag=industry_tag) for formula in formulas]
        copy_templates = [_to_copy_template(formula, industry_tag=industry_tag) for formula in formulas]
        derived_ingest = industry_kb_ingest_entries(
            tenant_id=effective_tenant,
            industry_tag=industry_tag,
            entries=startup_playbooks + copy_templates,
            trace_id=trace_id,
            actor_user_id=effective_user_id,
        )

        kb_ingested_count = int(formula_ingest.get("ingested_count", 0) or 0) + int(
            derived_ingest.get("ingested_count", 0) or 0
        )
        kb_rejected_count = int(formula_ingest.get("rejected_count", 0) or 0) + int(
            derived_ingest.get("rejected_count", 0) or 0
        )
        kb_duplicate_count = int(formula_ingest.get("duplicate_count", 0) or 0) + int(
            derived_ingest.get("duplicate_count", 0) or 0
        )

        report_markdown = _build_industry_dissect_report_markdown(
            industry_tag=industry_tag,
            trace_id=trace_id,
            competitor_accounts=accounts,
            formulas_count=len(formulas),
            startup_playbooks_count=len(startup_playbooks),
            copy_templates_count=len(copy_templates),
            kb_ingested_count=kb_ingested_count,
            kb_rejected_count=kb_rejected_count,
            kb_duplicate_count=kb_duplicate_count,
        )

        feishu_push_status = "skipped"
        feishu_push_detail: dict[str, Any] = {}
        if body.report_to_feishu:
            adapter = getattr(app.state, "feishu_channel", feishu_channel)
            client = getattr(app.state, "http_client", None)
            chat_id = str(body.feishu_chat_id or "industry_kb_report").strip()
            feishu_push_detail = await adapter.reply(chat_id=chat_id, text=report_markdown, client=client)
            feishu_push_status = "sent" if bool(feishu_push_detail.get("ok")) else "failed"

        _remember_event(
            user_id=effective_user_id,
            trace_id=trace_id,
            node="api.industry_kb_dissect_and_ingest",
            event_type="request_succeeded",
            payload={
                "industry_tag": industry_tag,
                "account_count": len(accounts),
                "formulas_count": len(formulas),
                "startup_playbooks_count": len(startup_playbooks),
                "copy_templates_count": len(copy_templates),
                "kb_ingested_count": kb_ingested_count,
                "kb_rejected_count": kb_rejected_count,
                "kb_duplicate_count": kb_duplicate_count,
                "feishu_push_status": feishu_push_status,
            },
            level="info",
        )

        return IndustryKbDissectIngestResponse(
            ok=True,
            trace_id=trace_id,
            thread_id=thread_id,
            user_id=effective_user_id,
            tenant_id=effective_tenant,
            industry_tag=industry_tag,
            account_dissect_node={
                "name": "competitor_analysis+competitor_formula_analyzer",
                "status": "completed",
                "accounts": accounts,
            },
            formulas_count=len(formulas),
            startup_playbooks_count=len(startup_playbooks),
            copy_templates_count=len(copy_templates),
            kb_ingested_count=kb_ingested_count,
            kb_rejected_count=kb_rejected_count,
            kb_duplicate_count=kb_duplicate_count,
            feishu_push_status=feishu_push_status,
            feishu_push_detail=feishu_push_detail,
            report_markdown=report_markdown,
            call_log=call_log,
        )
    except Exception as exc:  # noqa: BLE001
        _remember_event(
            user_id=effective_user_id,
            trace_id=trace_id,
            node="api.industry_kb_dissect_and_ingest",
            event_type="request_failed",
            payload={"industry_tag": industry_tag, "error": str(exc)},
            level="error",
        )
        raise HTTPException(status_code=500, detail=f"industry dissect and ingest failed: {exc}") from exc


@app.get("/industry-kb/search")
async def industry_kb_search(
    industry_tag: str = Query(..., min_length=1, max_length=64),
    query: str = Query(..., min_length=1, max_length=4000),
    tenant_id: str | None = Query(default=None),
    limit: int = Query(default=8, ge=1, le=50),
    entry_type: str | None = Query(default=None, max_length=64),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    row = industry_kb_build_runtime_context(
        tenant_id=effective_tenant,
        industry_tag=industry_tag,
        query=query,
        limit=limit,
    )
    if entry_type:
        entry_type_norm = str(entry_type).strip().lower()
        refs = [
            item
            for item in row.get("references", [])
            if str(item.get("entry_type") or "").strip().lower() == entry_type_norm
        ]
        row["references"] = refs
        row["count"] = len(refs)
    return row


@app.get("/industry-kb/stats")
async def industry_kb_stats(
    industry_tag: str = Query(..., min_length=1, max_length=64),
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    return industry_kb_profile_stats(tenant_id=effective_tenant, industry_tag=industry_tag)


@app.get("/industry-kb/metrics/dashboard")
async def industry_kb_metrics(
    industry_tag: str | None = Query(default=None, max_length=64),
    tenant_id: str | None = Query(default=None),
    from_utc: str | None = Query(default=None, alias="from"),
    to_utc: str | None = Query(default=None, alias="to"),
    granularity: str = Query(default="day", pattern="^(hour|day)$"),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    from_dt = _parse_dt(from_utc)
    to_dt = _parse_dt(to_utc)
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from must be <= to")
    return industry_kb_metrics_dashboard(
        tenant_id=effective_tenant,
        industry_tag=industry_kb_normalize_tag(industry_tag) if industry_tag else None,
        from_utc=from_dt.isoformat() if from_dt else None,
        to_utc=to_dt.isoformat() if to_dt else None,
        granularity=granularity,
    )


@app.get("/agent-rag/profiles")
async def agent_rag_profiles(
    current_user: UserClaims = Depends(_decode_user),
):
    return {"ok": True, "profiles": agent_rag_list_profiles()}


@app.get("/agent-rag/catalog")
async def agent_rag_catalog(
    profile: str = Query(default="feedback", min_length=1, max_length=32),
    current_user: UserClaims = Depends(_decode_user),
):
    _ = current_user
    return {"ok": True, "catalog": agent_rag_catalog_overview(profile)}


@app.get("/agent-rag/packs")
async def agent_rag_packs(
    tenant_id: str | None = Query(default=None),
    profile: str | None = Query(default=None, max_length=32),
    agent_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=200, ge=1, le=2000),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    normalized_profile = str(profile).strip() if profile else "feedback"
    normalized_agent = str(agent_id).strip().lower() if agent_id else None
    rows = agent_rag_list_packs(
        tenant_id=effective_tenant,
        profile=normalized_profile if normalized_profile else None,
        agent_id=normalized_agent if normalized_agent else None,
        limit=limit,
    )
    auto_seeded = False
    # Lazy bootstrap: if tenant has no packs yet, auto-seed fallback 9x10 packs so UI never stays empty.
    if not rows:
        try:
            targets = agent_rag_list_targets(normalized_profile or "feedback")
            for target in targets:
                if normalized_agent and target.agent_id != normalized_agent:
                    continue
                agent_rag_upsert_pack(
                    tenant_id=effective_tenant,
                    profile=target.profile,
                    agent_id=target.agent_id,
                    knowledge_pack_id=target.knowledge_pack_id,
                    knowledge_pack_name=target.knowledge_pack_name,
                    payload=agent_rag_fallback_pack(target),
                    model_name="auto_seed_fallback",
                    trace_id=f"agent_rag_auto_seed_{uuid.uuid4().hex[:10]}",
                    fallback_used=True,
                    updated_by="system:auto_seed",
                )
            rows = agent_rag_list_packs(
                tenant_id=effective_tenant,
                profile=normalized_profile if normalized_profile else None,
                agent_id=normalized_agent if normalized_agent else None,
                limit=limit,
            )
            auto_seeded = len(rows) > 0
        except Exception:
            auto_seeded = False
    summary = agent_rag_summary_by_agent(
        tenant_id=effective_tenant,
        profile=normalized_profile if normalized_profile else None,
    )
    return {
        "ok": True,
        "tenant_id": effective_tenant,
        "count": len(rows),
        "summary": summary,
        "items": rows,
        "auto_seeded": auto_seeded,
    }


@app.post("/agent-rag/generate-pack")
async def agent_rag_generate_pack(
    body: AgentRagGenerateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    trace_id = str(body.trace_id or f"agent_rag_{uuid.uuid4().hex[:12]}")
    target = agent_rag_resolve_target(
        profile=str(body.profile).strip(),
        agent_id=str(body.agent_id).strip(),
        knowledge_pack_id=str(body.knowledge_pack_id).strip(),
    )
    result = await agent_rag_generate_pack_with_retry(
        target=target,
        tenant_id=effective_tenant,
        user_id=current_user.sub,
        max_retries=body.max_retries,
        model_override=body.model_name,
        system_prompt_path=body.system_prompt_path,
        allow_fallback=True,
    )
    if not bool(result.get("ok", False)):
        raise HTTPException(status_code=500, detail={"error": result.get("error", "rag_pack_generation_failed")})
    pack = dict(result.get("pack") or {})
    saved: dict[str, Any] | None = None
    if body.persist:
        saved = agent_rag_upsert_pack(
            tenant_id=effective_tenant,
            profile=target.profile,
            agent_id=target.agent_id,
            knowledge_pack_id=target.knowledge_pack_id,
            knowledge_pack_name=target.knowledge_pack_name,
            payload=pack,
            model_name=str(body.model_name or ""),
            trace_id=trace_id,
            fallback_used=bool(result.get("fallback_used", False)),
            updated_by=current_user.sub,
        )
    _remember_event(
        user_id=current_user.sub,
        trace_id=trace_id,
        node="agent_rag.generate_pack",
        event_type="generated",
        payload={
            "tenant_id": effective_tenant,
            "profile": target.profile,
            "agent_id": target.agent_id,
            "knowledge_pack_id": target.knowledge_pack_id,
            "fallback_used": bool(result.get("fallback_used", False)),
            "persist": bool(body.persist),
            "error": str(result.get("error", "")),
        },
        level="info",
    )
    return {
        "ok": True,
        "trace_id": trace_id,
        "tenant_id": effective_tenant,
        "profile": target.profile,
        "agent_id": target.agent_id,
        "knowledge_pack_id": target.knowledge_pack_id,
        "attempt": int(result.get("attempt", 0) or 0),
        "fallback_used": bool(result.get("fallback_used", False)),
        "error": str(result.get("error", "")),
        "generated_pack": pack,
        "saved": saved,
    }


@app.get("/economy/status")
async def economy_status(
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    return {"ok": True, "economy": clawwork_status(effective_user_id)}


@app.post("/economy/credit")
async def economy_credit(
    body: EconomyCreditRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    wallet = credit_wallet(body.user_id, body.amount_cny, note=body.note or "admin_credit")
    _remember_event(
        user_id=body.user_id,
        trace_id=None,
        node="economy",
        event_type="credit_applied",
        payload={"amount_cny": body.amount_cny, "note": body.note or "admin_credit"},
        level="info",
    )
    return {"ok": True, "wallet": wallet}


@app.get("/economy/daily-report")
async def economy_daily_report(
    user_id: str | None = Query(default=None),
    days: int = Query(default=7, ge=1, le=90),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    report = clawwork_daily_report(user_id=effective_user_id, days=days)
    return {"ok": True, "report": report}


@app.get("/clawteam/queue")
async def clawteam_queue_status(
    trace_id: str = Query(..., min_length=1, max_length=128),
    user_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    lane: str | None = Query(default=None, max_length=64),
    status_filter: str | None = Query(default=None, alias="status", max_length=32),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    summary = clawteam_summary(user_id=effective_user_id, trace_id=trace_id)
    ready = clawteam_get_ready_tasks(user_id=effective_user_id, trace_id=trace_id, limit=limit)
    tasks = clawteam_list_tasks(
        user_id=effective_user_id,
        trace_id=trace_id,
        limit=limit,
        status=status_filter,
        lane=lane,
    )
    return {"ok": True, "summary": summary, "ready_tasks": ready, "tasks": tasks}


@app.get("/clawteam/workers")
async def clawteam_workers(
    trace_id: str = Query(..., min_length=1, max_length=128),
    user_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    workers = clawteam_list_workers(user_id=effective_user_id, trace_id=trace_id, limit=limit)
    return {
        "ok": True,
        "summary": clawteam_summary(user_id=effective_user_id, trace_id=trace_id),
        "workers": workers,
    }


@app.post("/clawteam/worker/heartbeat")
async def clawteam_worker_heartbeat(
    body: ClawTeamWorkerHeartbeatRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = body.user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    worker = clawteam_heartbeat_worker(
        worker_id=body.worker_id,
        user_id=effective_user_id,
        trace_id=body.trace_id,
        lanes=body.lanes,
        status=body.status,
        meta=body.meta,
    )
    return {
        "ok": True,
        "worker": worker,
        "summary": clawteam_summary(user_id=effective_user_id, trace_id=body.trace_id),
    }


@app.post("/clawteam/worker/claim")
async def clawteam_worker_claim(
    body: ClawTeamWorkerClaimRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = body.user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    claimed = clawteam_claim_ready_tasks(
        user_id=effective_user_id,
        trace_id=body.trace_id,
        worker_id=body.worker_id,
        lanes=body.lanes,
        limit=body.limit,
    )
    return {
        "ok": True,
        "claimed_count": len(claimed),
        "claimed_tasks": claimed,
        "summary": clawteam_summary(user_id=effective_user_id, trace_id=body.trace_id),
    }


@app.post("/clawteam/worker/ack")
async def clawteam_worker_ack(
    body: ClawTeamWorkerAckRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = body.user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")

    completed_keys = [str(x).strip() for x in body.completed_task_keys if str(x).strip()]
    failed_keys = [str(x).strip() for x in body.failed_task_keys if str(x).strip()]
    completed_count = 0
    failed_count = 0
    if completed_keys:
        completed_count = clawteam_mark_many_completed(
            trace_id=body.trace_id,
            task_keys=completed_keys,
            worker_id=body.worker_id,
        )
    if failed_keys:
        failed_count = clawteam_mark_many_failed(
            trace_id=body.trace_id,
            task_keys=failed_keys,
            worker_id=body.worker_id,
            error=body.error or "worker_reported_failure",
        )
    return {
        "ok": True,
        "completed_count": completed_count,
        "failed_count": failed_count,
        "summary": clawteam_summary(user_id=effective_user_id, trace_id=body.trace_id),
    }


@app.post("/clawteam/requeue-stale")
async def clawteam_requeue_stale(
    body: ClawTeamRequeueRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = body.user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    result = clawteam_requeue_stale_running_tasks(
        user_id=effective_user_id,
        trace_id=body.trace_id,
        stale_after_sec=body.stale_after_sec,
        max_attempt_count=body.max_attempt_count,
    )
    return {
        "ok": True,
        "result": result,
        "summary": clawteam_summary(user_id=effective_user_id, trace_id=body.trace_id),
    }


@app.get("/policy/bandit")
async def policy_bandit_status(
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    return {"ok": True, "policy_bandit": policy_bandit_snapshot(effective_user_id)}


@app.get("/followup/spawns/recent")
async def followup_recent_spawns(
    user_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    rows = followup_list_recent_spawn_runs(
        tenant_id=current_user.tenant_id,
        user_id=effective_user_id,
        limit=limit,
    )
    return {"ok": True, "count": len(rows), "spawns": rows}


@app.get("/followup/spawns/{trace_id}")
async def followup_spawn_by_trace(
    trace_id: str,
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    row = followup_get_spawn_run(
        tenant_id=current_user.tenant_id,
        user_id=effective_user_id,
        trace_id=trace_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="followup_spawn_not_found")
    return {"ok": True, "spawn": row}


@app.get("/observability/langsmith")
async def observability_langsmith(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "langsmith": getattr(app.state, "langsmith", {"enabled": False})}


@app.get("/integrations/overview")
async def integrations_overview(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")

    http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
    anythingllm_row: dict[str, Any] = {"ok": False, "error": "http_client_unavailable"}
    if http_client is not None:
        anythingllm_row = await fetch_anythingllm_health(http_client)

    readiness = _delivery_readiness_snapshot()
    router_desc = llm_router.describe()
    comfyui_row = await integration_comfyui_status()
    return {
        "ok": True,
        "integrations": {
            "clawrouter": router_desc.get("clawrouter", {}),
            "clawwork": clawwork_status(),
            "feishu": feishu_channel.describe(),
            "dingtalk": dingtalk_channel.describe(),
            "clawteam": {
                "db_path": os.getenv("CLAWTEAM_DB_PATH", "./data/clawteam_inbox.sqlite"),
            },
            "policy_bandit": {
                "enabled": os.getenv("POLICY_BANDIT_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"},
                "db_path": os.getenv("POLICY_BANDIT_DB_PATH", "./data/policy_bandit.sqlite"),
            },
            "rag_anything": readiness.get("rag", {}).get("multimodal", {}),
            "cli_anything": {
                "registered_edges": readiness.get("registered_edges", 0),
                "registered_edges_with_commands": readiness.get("registered_edges_with_commands", 0),
                "known_edge_skills": readiness.get("known_edge_skills", []),
                "known_edge_commands": readiness.get("known_edge_commands", []),
            },
            "anythingllm": anythingllm_row,
            "comfyui": comfyui_row,
            "libtv": integration_libtv_status(),
        },
    }


@app.get("/integrations/comfyui/status")
async def integrations_comfyui_status(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "comfyui": await integration_comfyui_status()}


@app.get("/integrations/comfyui/capabilities")
async def integrations_comfyui_capabilities(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    row = inspect_comfyui_capabilities()
    return {"ok": True, "capabilities": row}


@app.post("/integrations/comfyui/pipeline/plan")
async def integrations_comfyui_pipeline_plan(
    body: ComfyPipelinePlanRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    snapshot = inspect_comfyui_capabilities()
    generation_plan = build_comfyui_generation_plan(
        task_description=body.task_description,
        industry=body.industry,
        capability_snapshot=snapshot,
        force_human_approval=body.force_human_approval,
    )
    post_plan = build_post_production_plan(
        media_urls=[str(item).strip() for item in body.media_urls if str(item).strip()],
        industry=body.industry,
        auto_image_retouch=bool((generation_plan.get("auto_post_production", {}) or {}).get("auto_image_retouch", True)),
        auto_video_edit=bool((generation_plan.get("auto_post_production", {}) or {}).get("auto_video_edit", True)),
        auto_clip_cut=bool((generation_plan.get("auto_post_production", {}) or {}).get("auto_clip_cut", True)),
        digital_human_mode=bool(generation_plan.get("digital_human_mode", False)),
        vlog_narration_mode=bool(generation_plan.get("vlog_narration_mode", False)),
    )
    return {
        "ok": True,
        "industry": str(body.industry or "general").strip().lower() or "general",
        "generation_plan": generation_plan,
        "post_production_plan": post_plan,
        "capability_snapshot": snapshot,
    }


@app.get("/integrations/comfyui/prompt/{prompt_id}")
async def integrations_comfyui_prompt(
    prompt_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    row = await integration_comfyui_query_prompt(prompt_id=prompt_id)
    return {"ok": bool(row.get("ok")), "prompt": row}


@app.get("/integrations/comfyui/workflow-templates")
async def integrations_comfyui_workflow_templates(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    env_rows = integration_list_workflow_templates()
    registry_rows = registry_list_templates()
    return {
        "ok": True,
        "count": len(registry_rows),
        "templates": registry_rows,
        "fallback_env_templates": env_rows,
    }


@app.get("/integrations/comfyui/workflow-templates/sources")
async def integrations_comfyui_workflow_template_sources(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    rows = registry_recommended_github_sources()
    return {"ok": True, "count": len(rows), "sources": rows}


@app.get("/integrations/comfyui/workflow-templates/recommend")
async def integrations_comfyui_workflow_template_recommend(
    industry: str = Query(default="general", min_length=1, max_length=64),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    row = await workflow_recommend_official_templates(industry=industry, limit=limit)
    return row


@app.post("/integrations/comfyui/workflow-templates/import")
async def integrations_comfyui_import_workflow_template(
    body: ComfyTemplateImportRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    imported = await registry_import_template_from_github_raw(
        industry=body.industry,
        name=body.name,
        raw_url=body.raw_url,
        source_repo=str(body.source_repo or "").strip(),
        ref=str(body.ref or "main").strip() or "main",
    )
    if not imported.get("ok"):
        raise HTTPException(status_code=400, detail=str(imported.get("error", "import_failed")))

    activated: dict[str, Any] | None = None
    if body.activate:
        activated = registry_activate_template(industry=body.industry, name=body.name)
        if not activated.get("ok"):
            raise HTTPException(status_code=400, detail=str(activated.get("error", "activate_failed")))
    return {"ok": True, "imported": imported, "activated": activated}


@app.post("/integrations/comfyui/workflow-templates/activate")
async def integrations_comfyui_activate_workflow_template(
    body: ComfyTemplateActivateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    row = registry_activate_template(industry=body.industry, name=body.name)
    if not row.get("ok"):
        raise HTTPException(status_code=400, detail=str(row.get("error", "activate_failed")))
    return {"ok": True, "activation": row}


@app.get("/integrations/libtv/status")
async def integrations_libtv_status(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {"ok": True, "libtv": integration_libtv_status()}


@app.get("/integrations/libtv/session/{session_id}")
async def integrations_libtv_session(
    session_id: str,
    after_seq: int = Query(default=0, ge=0),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    row = await integration_libtv_query_session(session_id=session_id, after_seq=after_seq)
    return {"ok": bool(row.get("ok")), "session": row}


@app.get("/integrations/anythingllm/status")
async def anythingllm_status(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
    if http_client is None:
        return {"ok": False, "error": "http_client_unavailable"}
    status_row = await fetch_anythingllm_health(http_client)
    return {"ok": bool(status_row.get("ok")), "anythingllm": status_row}


@app.post("/integrations/feishu/test")
async def integrations_feishu_test(
    body: FeishuTestRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")

    http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
    if http_client is None:
        return {"ok": False, "error": "http_client_unavailable"}

    adapter = getattr(app.state, "feishu_channel", feishu_channel)
    adapter_status = adapter.describe()
    if not adapter_status.get("enabled"):
        return {"ok": False, "error": "feishu_disabled", "adapter": adapter_status}

    if adapter_status.get("reply_mode") == "openapi" and not body.chat_id:
        raise HTTPException(status_code=400, detail="chat_id required when FEISHU_REPLY_MODE=openapi")

    test_chat_id = body.chat_id or f"tenant:{current_user.tenant_id}"
    result = await adapter.reply(
        chat_id=test_chat_id,
        text=body.message,
        client=http_client,
    )
    return {
        "ok": bool(result.get("ok")),
        "result": result,
        "adapter": adapter_status,
        "channel": "feishu",
    }


@app.get("/integrations/feishu/status")
async def integrations_feishu_status(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    adapter = getattr(app.state, "feishu_channel", feishu_channel)
    return {
        "ok": True,
        "channel": "feishu",
        "adapter": adapter.describe(),
        "callback_url": _feishu_callback_url(),
        "verify_signature": _chat_verify_enabled("feishu"),
        "has_verification_token": bool(_chat_verification_token("feishu")),
        "has_signing_secret": bool(_chat_signing_secret("feishu")),
    }


@app.get("/integrations/feishu/callback-readiness")
async def integrations_feishu_callback_readiness(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    callback_url = _feishu_callback_url()
    checks = {
        "public_base_url_configured": bool(_public_base_url()),
        "callback_url_configured": bool(callback_url),
        "feishu_enabled": _env_bool("FEISHU_ENABLED", False),
        "reply_mode_valid": os.getenv("FEISHU_REPLY_MODE", "webhook").strip().lower() in {"webhook", "openapi"},
        "verification_token_configured": bool(_chat_verification_token("feishu")),
        "signing_secret_configured": bool(_chat_signing_secret("feishu")),
        "app_credentials_configured": bool(os.getenv("FEISHU_APP_ID", "").strip() and os.getenv("FEISHU_APP_SECRET", "").strip()),
    }
    ready = (
        checks["callback_url_configured"]
        and checks["feishu_enabled"]
        and checks["reply_mode_valid"]
        and (checks["verification_token_configured"] or checks["signing_secret_configured"])
    )
    return {
        "ok": True,
        "ready": ready,
        "callback_url": callback_url,
        "checks": checks,
        "next_step": "Run scripts/preflight_feishu_callback.py before subscribing the app to public callbacks.",
    }


@app.get("/integrations/anythingllm/embed/snippet")
async def anythingllm_embed_snippet(
    embed_id: str = Query(..., min_length=1, max_length=120),
    width: str = Query(default="100%"),
    height: str = Query(default="680px"),
    auto_workspace: bool = Query(default=True),
    current_user: UserClaims = Depends(_decode_user),
):
    workspace_slug = None
    if auto_workspace:
        http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
        if http_client is not None:
            workspace_row = await ensure_anythingllm_workspace(
                client=http_client,
                tenant_id=current_user.tenant_id,
                user_external_id=current_user.sub,
            )
            workspace_slug = str(
                (workspace_row.get("workspace") or {}).get("slug")
                or workspace_row.get("workspace_slug")
                or ""
            ).strip() or None
    snippet = build_embed_snippet(
        embed_id=embed_id,
        user_external_id=current_user.sub,
        tenant_id=current_user.tenant_id,
        workspace_slug=workspace_slug,
        width=width,
        height=height,
    )
    return {"ok": True, "embed_id": embed_id, "workspace_slug": workspace_slug, "snippet": snippet}


@app.post("/integrations/anythingllm/workspaces/ensure")
async def anythingllm_workspace_ensure(
    body: AnythingLLMWorkspaceEnsureRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if body.user_id and current_user.sub != body.user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")

    user_id = body.user_id or current_user.sub
    tenant_id = body.tenant_id or current_user.tenant_id

    http_client: httpx.AsyncClient | None = getattr(app.state, "http_client", None)
    if http_client is None:
        raise HTTPException(status_code=503, detail="http_client_unavailable")

    workspace_row = await ensure_anythingllm_workspace(
        client=http_client,
        tenant_id=tenant_id,
        user_external_id=user_id,
        workspace_name=body.workspace_name,
    )
    return {
        "ok": bool(workspace_row.get("ok")),
        "workspace": workspace_row,
    }


@app.get("/hitl/pending")
async def list_hitl_pending(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    items_map: dict[str, dict[str, Any]] = {}
    for row in list(app.state.hitl_pending.values()):
        approval_id = str(row.get("approval_id") or "").strip()
        if approval_id:
            items_map[approval_id] = dict(row)

    redis: Redis | None = getattr(app.state, "redis", None)
    if redis is not None:
        try:
            approval_ids = await redis.zrevrange("hitl:pending:index", 0, max(0, limit - 1))
            for approval_id in approval_ids:
                key = f"hitl:approval:{approval_id}"
                data = await redis.hgetall(key)
                if not data:
                    continue
                payload = {}
                if "payload" in data:
                    try:
                        payload = json.loads(data["payload"])
                    except json.JSONDecodeError:
                        payload = {}
                items_map[str(approval_id)] = {
                    **(payload if isinstance(payload, dict) else {}),
                    "approval_id": str(approval_id),
                    "status": data.get("status", "pending"),
                    "updated_at": data.get("updated_at"),
                }
        except Exception:  # noqa: BLE001
            pass

    items = list(items_map.values())
    items.sort(key=lambda row: str(row.get("created_at", row.get("updated_at", ""))), reverse=True)
    return {"ok": True, "count": min(len(items), limit), "items": items[:limit]}


@app.get("/hitl/status/{approval_id}")
async def hitl_status(
    approval_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_id = approval_id.strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="approval_id is required")
    status_row = await _read_hitl_status(target_id)
    in_memory = app.state.hitl_pending.get(target_id) or {}
    return {
        "ok": True,
        "approval_id": target_id,
        "status": status_row,
        "record": in_memory,
    }


@app.post("/hitl/decide", dependencies=[Depends(_verify_hitl_secret)])
async def decide_hitl(body: HitlDecisionRequest):
    decision = body.decision.strip().lower()
    if decision not in {"approved", "rejected"}:
        raise HTTPException(status_code=400, detail="decision must be approved/rejected")
    operator = (body.operator or "unknown_operator").strip()[:128]
    reason = (body.reason or "").strip()[:500]
    return await _set_hitl_decision(body.approval_id.strip(), decision, operator, reason)


@app.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    subject, tenant_id, roles, is_legacy, auth_user = await _authenticate_login_identity(
        body.username,
        body.password,
        body.otp_code,
        source="auth_login",
    )
    if is_legacy:
        return _create_access_token(subject, tenant_id, roles)
    access_token = await issue_access_token_for_user(auth_user)
    return LoginResponse(
        access_token=access_token,
        expires_in=_jwt_ttl_minutes() * 60,
    )


@app.get("/auth/me")
async def me(current_user: UserClaims = Depends(_decode_user)):
    return {
        "username": current_user.sub,
        "tenant_id": current_user.tenant_id,
        "roles": current_user.roles,
        "token_exp": current_user.exp,
    }


@app.get("/.well-known/openid-configuration")
async def oidc_openid_configuration(request: Request):
    issuer = _oidc_issuer(request)
    return get_oidc_provider().discovery_document(issuer)


@app.get("/oauth2/jwks")
async def oidc_jwks():
    return get_oidc_provider().build_jwks()


@app.get("/oauth2/authorize")
async def oidc_authorize():
    return JSONResponse(
        status_code=501,
        content={
            "error": "unsupported_response_type",
            "error_description": "Only password grant is supported by this OIDC compatibility layer",
        },
    )


@app.post("/oauth2/token")
async def oidc_token(request: Request):
    payload = await _read_request_payload(request)
    grant_type = str(payload.get("grant_type") or "").strip().lower()
    if grant_type != "password":
        return JSONResponse(
            status_code=400,
            content={
                "error": "unsupported_grant_type",
                "error_description": "Only password grant is supported",
            },
        )

    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    otp_code = str(
        payload.get("otp_code")
        or payload.get("mfa_code")
        or payload.get("totp_code")
        or ""
    ).strip() or None
    if not username or not password:
        return JSONResponse(
            status_code=400,
            content={
                "error": "invalid_request",
                "error_description": "username and password are required",
            },
        )

    client_id = str(payload.get("client_id") or "").strip() or None
    scope = str(payload.get("scope") or "openid profile tenant roles").strip() or "openid profile tenant roles"
    try:
        subject, tenant_id, roles, _, _ = await _authenticate_login_identity(
            username,
            password,
            otp_code,
            source="oidc_password_grant",
        )
    except HTTPException as exc:
        detail = str(exc.detail or "invalid_grant")
        await get_audit_service().log(
            event_type=AuditEventType.AUTH_LOGIN_FAILED,
            tenant_id="tenant_unknown",
            user_id=username or "unknown",
            resource_type="oidc_token",
            resource_id=username or "unknown",
            details={
                "source": "oidc_password_grant",
                "grant_type": grant_type,
                "detail": detail,
                "client_id": client_id,
            },
        )
        error_name = "invalid_grant"
        status_code = 401
        if detail == "mfa_required":
            error_name = "mfa_required"
        elif detail == "invalid_mfa_code":
            error_name = "invalid_mfa_code"
        elif detail == "Username or password incorrect":
            error_name = "invalid_grant"
        else:
            status_code = int(exc.status_code or 401)
        return JSONResponse(
            status_code=status_code,
            content={
                "error": error_name,
                "error_description": detail,
            },
        )

    issuer = _oidc_issuer(request)
    audience = _oidc_default_audience(client_id)
    tokens = get_oidc_provider().issue_tokens(
        issuer=issuer,
        subject=subject,
        tenant_id=tenant_id,
        roles=roles,
        audience=audience,
        preferred_username=subject,
        scope=scope,
        lifetime_sec=_jwt_ttl_minutes() * 60,
    )
    await get_audit_service().log(
        event_type=AuditEventType.AUTH_LOGIN,
        tenant_id=tenant_id,
        user_id=subject,
        resource_type="oidc_token",
        resource_id=subject,
        details={
            "source": "oidc_password_grant",
            "grant_type": grant_type,
            "client_id": client_id,
            "audience": audience,
        },
    )
    return tokens


@app.get("/oauth2/userinfo")
async def oidc_userinfo(claims: dict[str, Any] = Depends(_decode_oidc_claims)):
    roles = claims.get("roles")
    if not isinstance(roles, list):
        roles = []
    return {
        "sub": str(claims.get("sub") or ""),
        "preferred_username": str(claims.get("preferred_username") or claims.get("sub") or ""),
        "tenant_id": str(claims.get("tenant_id") or ""),
        "roles": [str(role) for role in roles],
        "scope": str(claims.get("scope") or ""),
        "aud": claims.get("aud"),
        "iss": str(claims.get("iss") or ""),
        "token_use": str(claims.get("token_use") or ""),
    }


@app.post("/oauth2/introspect")
async def oidc_introspect(request: Request):
    payload = await _read_request_payload(request)
    token = str(payload.get("token") or "").strip()
    if not token:
        return {"active": False}
    try:
        claims = get_oidc_provider().verify_token(token)
    except Exception:
        return {"active": False}

    roles = claims.get("roles")
    if not isinstance(roles, list):
        roles = []
    return {
        "active": True,
        "sub": str(claims.get("sub") or ""),
        "tenant_id": str(claims.get("tenant_id") or ""),
        "preferred_username": str(claims.get("preferred_username") or claims.get("sub") or ""),
        "roles": [str(role) for role in roles],
        "scope": str(claims.get("scope") or ""),
        "client_id": str(payload.get("client_id") or ""),
        "token_type": "Bearer",
        "token_use": str(claims.get("token_use") or ""),
        "aud": claims.get("aud"),
        "iss": str(claims.get("iss") or ""),
        "iat": int(claims.get("iat") or 0),
        "exp": int(claims.get("exp") or 0),
    }


@app.get("/api/v1/auth/sso/providers")
async def list_sso_federation_providers(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    providers = [
        item.to_public_dict()
        for item in get_federation_store().list_providers(current_user.tenant_id)
    ]
    return {"ok": True, "items": providers}


@app.get("/api/v1/auth/sso/discover", response_model=SsoDiscoveryResponse)
async def discover_sso_federation_provider(
    email: str = Query(..., min_length=3, max_length=320),
    tenant_id: str | None = Query(default=None, max_length=128),
):
    target_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
    provider = discover_provider_for_email(target_tenant, email)
    if provider is None:
        return SsoDiscoveryResponse(ok=True, matched=False, reason="provider_not_found")
    return SsoDiscoveryResponse(
        ok=True,
        matched=True,
        provider_id=provider.provider_id,
        provider_name=provider.name,
        authorize_url=f"/auth/sso/providers/{provider.provider_id}/authorize",
    )


@app.get("/api/v1/auth/sso/providers/{provider_id}")
async def get_sso_federation_provider(provider_id: str, current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    provider = get_federation_store().get_provider(provider_id)
    if provider is None or provider.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="sso_provider_not_found")
    return {"ok": True, "provider": provider.to_public_dict()}


@app.post("/api/v1/auth/sso/providers/{provider_id}/test")
async def test_sso_federation_provider(
    provider_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    provider = get_federation_store().get_provider(provider_id)
    if provider is None or provider.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="sso_provider_not_found")
    report = await test_provider_configuration(provider)
    return {"ok": True, "report": report}


@app.post("/api/v1/auth/sso/providers")
async def create_sso_federation_provider(
    body: FederationProviderUpsertRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    payload = body.model_dump()
    payload["tenant_id"] = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    if payload["tenant_id"] != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    hydrated = await hydrate_provider_metadata(payload)
    provider = get_federation_store().upsert_provider(hydrated)
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="sso_provider",
        resource_id=provider.provider_id,
        details={"operation": "create", "issuer": provider.issuer, "name": provider.name},
    )
    return {"ok": True, "provider": provider.to_public_dict()}


@app.get("/auth/sso/start")
async def start_sso_from_email(
    request: Request,
    email: str = Query(..., min_length=3, max_length=320),
    tenant_id: str | None = Query(default=None, max_length=128),
    next: str | None = Query(default=None),
):
    target_tenant = str(tenant_id or "tenant_main").strip() or "tenant_main"
    provider = discover_provider_for_email(target_tenant, email)
    if provider is None:
        raise HTTPException(status_code=404, detail="sso_provider_not_found")
    target = f"/auth/sso/providers/{provider.provider_id}/authorize"
    query: dict[str, str] = {}
    if next:
        query["next"] = next
    if query:
        target = f"{target}?{urllib.parse.urlencode(query)}"
    return RedirectResponse(url=target, status_code=307)


@app.put("/api/v1/auth/sso/providers/{provider_id}")
async def update_sso_federation_provider(
    provider_id: str,
    body: FederationProviderUpsertRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    existing = get_federation_store().get_provider(provider_id)
    if existing is None or existing.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="sso_provider_not_found")
    payload = body.model_dump()
    payload["tenant_id"] = current_user.tenant_id
    hydrated = await hydrate_provider_metadata(payload)
    provider = get_federation_store().upsert_provider(hydrated, provider_id=provider_id)
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="sso_provider",
        resource_id=provider.provider_id,
        details={"operation": "update", "issuer": provider.issuer, "name": provider.name},
    )
    return {"ok": True, "provider": provider.to_public_dict()}


@app.delete("/api/v1/auth/sso/providers/{provider_id}")
async def delete_sso_federation_provider(
    provider_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    provider = get_federation_store().get_provider(provider_id)
    if provider is None or provider.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="sso_provider_not_found")
    deleted = get_federation_store().delete_provider(provider_id)
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="sso_provider",
        resource_id=provider_id,
        details={"operation": "delete", "deleted": deleted, "issuer": provider.issuer},
    )
    return {"ok": True, "deleted": deleted}


@app.post("/auth/sso/exchange")
async def exchange_federated_token(body: FederatedExchangeRequest):
    provider = get_federation_store().get_provider(body.provider_id)
    if provider is None or not provider.enabled:
        raise HTTPException(status_code=404, detail="sso_provider_not_found")
    try:
        claims = verify_federated_token(provider, body.token)
        identity = extract_federated_identity(provider, claims)
        user = await resolve_or_provision_federated_user(provider, identity)
        access_token = await issue_access_token_for_user(user)
    except Exception as exc:
        await get_audit_service().log(
            event_type=AuditEventType.AUTH_LOGIN_FAILED,
            tenant_id=provider.tenant_id,
            user_id="federated_unknown",
            resource_type="sso_provider",
            resource_id=provider.provider_id,
            details={"source": "federated_exchange", "error": str(exc)},
        )
        raise HTTPException(status_code=401, detail="federated_auth_failed") from exc

    resolved_claims = claims_from_user(user)
    await get_audit_service().log(
        event_type=AuditEventType.AUTH_LOGIN,
        tenant_id=provider.tenant_id,
        user_id=resolved_claims.sub,
        resource_type="sso_provider",
        resource_id=provider.provider_id,
        details={
            "source": "federated_exchange",
            "issuer": provider.issuer,
            "external_subject": identity.subject,
        },
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": _jwt_ttl_minutes() * 60,
        "provider_id": provider.provider_id,
        "tenant_id": resolved_claims.tenant_id,
        "roles": resolved_claims.roles,
        "username": resolved_claims.sub,
    }


@app.get("/auth/sso/providers/{provider_id}/authorize")
async def authorize_federated_login(
    provider_id: str,
    request: Request,
    next: str | None = Query(default=None),
):
    provider = get_federation_store().get_provider(provider_id)
    if provider is None or not provider.enabled:
        raise HTTPException(status_code=404, detail="sso_provider_not_found")
    if not provider.client_id:
        raise HTTPException(status_code=400, detail="sso_provider_client_id_missing")
    redirect_uri = f"{_oidc_issuer(request)}/auth/sso/callback"
    redirect_after_login = _resolve_safe_post_login_redirect(next, request)
    nonce = secrets.token_urlsafe(16)
    code_verifier = ""
    code_challenge = ""
    if provider.use_pkce:
        code_verifier, code_challenge = build_pkce_pair()
    auth_request = get_federation_store().create_auth_request(
        provider_id=provider.provider_id,
        tenant_id=provider.tenant_id,
        redirect_after_login=redirect_after_login,
        redirect_uri=redirect_uri,
        nonce=nonce,
        code_verifier=code_verifier,
        ttl_sec=600,
    )
    try:
        authorization_url = build_authorization_url(
            provider,
            state=auth_request.state,
            redirect_uri=redirect_uri,
            nonce=nonce,
            code_challenge=code_challenge,
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return RedirectResponse(url=authorization_url, status_code=307)


@app.get("/auth/sso/callback")
async def sso_federation_callback(
    request: Request,
    code: str = Query(..., min_length=1, max_length=5000),
    state: str = Query(..., min_length=8, max_length=500),
):
    auth_request = get_federation_store().consume_auth_request(state)
    if auth_request is None:
        raise HTTPException(status_code=400, detail="sso_state_invalid_or_expired")
    provider = get_federation_store().get_provider(auth_request.provider_id)
    if provider is None or not provider.enabled:
        raise HTTPException(status_code=404, detail="sso_provider_not_found")
    try:
        token_payload = await exchange_authorization_code_for_tokens(
            provider,
            code=code,
            redirect_uri=auth_request.redirect_uri,
            code_verifier=auth_request.code_verifier,
        )
        claims = verify_federated_token_response(
            provider,
            token_payload,
            expected_nonce=auth_request.nonce,
        )
        identity = extract_federated_identity(provider, claims)
        user = await resolve_or_provision_federated_user(provider, identity)
        access_token = await issue_access_token_for_user(user)
        resolved_claims = claims_from_user(user)
        await get_audit_service().log(
            event_type=AuditEventType.AUTH_LOGIN,
            tenant_id=provider.tenant_id,
            user_id=resolved_claims.sub,
            resource_type="sso_provider",
            resource_id=provider.provider_id,
            details={
                "source": "federated_authorize_callback",
                "issuer": provider.issuer,
                "external_subject": identity.subject,
            },
        )
    except Exception as exc:
        await get_audit_service().log(
            event_type=AuditEventType.AUTH_LOGIN_FAILED,
            tenant_id=provider.tenant_id,
            user_id="federated_unknown",
            resource_type="sso_provider",
            resource_id=provider.provider_id,
            details={"source": "federated_authorize_callback", "error": str(exc)},
        )
        error_redirect = _append_fragment_params(
            auth_request.redirect_after_login,
            {"error": "sso_callback_failed", "provider_id": provider.provider_id},
        )
        return RedirectResponse(url=error_redirect, status_code=307)

    success_redirect = _append_fragment_params(
        auth_request.redirect_after_login,
        {
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": _jwt_ttl_minutes() * 60,
            "provider_id": provider.provider_id,
            "tenant_id": resolved_claims.tenant_id,
            "username": resolved_claims.sub,
        },
    )
    return RedirectResponse(url=success_redirect, status_code=307)


@app.get("/scim/v2/ServiceProviderConfig")
async def scim_service_provider_config(
    request: Request,
    _: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    return build_scim_service_provider_config(base_url)


@app.get("/scim/v2/Schemas")
async def scim_schemas(
    request: Request,
    _: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    return build_scim_schemas(base_url)


@app.get("/scim/v2/ResourceTypes")
async def scim_resource_types(
    request: Request,
    _: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    return build_scim_resource_types(base_url)


@app.get("/scim/v2/Users")
async def scim_list_users(
    request: Request,
    filter: str | None = Query(default=None),
    startIndex: int = Query(default=1, ge=1),
    count: int = Query(default=100, ge=1, le=200),
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    return await list_scim_users(
        tenant_id=principal.tenant_id,
        base_url=base_url,
        start_index=startIndex,
        count=count,
        filter_expr=filter,
    )


@app.get("/scim/v2/Groups")
async def scim_list_groups_route(
    request: Request,
    filter: str | None = Query(default=None),
    startIndex: int = Query(default=1, ge=1),
    count: int = Query(default=100, ge=1, le=200),
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    return await list_scim_groups(
        tenant_id=principal.tenant_id,
        base_url=base_url,
        start_index=startIndex,
        count=count,
        filter_expr=filter,
    )


@app.post("/scim/v2/Groups")
async def scim_create_group_route(
    request: Request,
    body: dict[str, Any],
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    try:
        resource = await create_scim_group(
            tenant_id=principal.tenant_id,
            payload=body,
            base_url=base_url,
        )
    except ScimConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=principal.tenant_id,
        user_id=principal.actor_id,
        resource_type="scim_group",
        resource_id=str(resource.get("id") or ""),
        details={
            "source": "scim",
            "auth_mode": principal.auth_mode,
            "display_name": resource.get("displayName"),
            "member_count": len(resource.get("members", [])),
        },
    )
    return JSONResponse(status_code=201, content=resource)


@app.get("/scim/v2/Groups/{group_id}")
async def scim_get_group_route(
    request: Request,
    group_id: str,
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    try:
        return await get_scim_group(tenant_id=principal.tenant_id, group_id=group_id, base_url=base_url)
    except ScimNotFoundError as exc:
        raise HTTPException(status_code=404, detail="scim_group_not_found") from exc


@app.put("/scim/v2/Groups/{group_id}")
async def scim_replace_group_route(
    request: Request,
    group_id: str,
    body: dict[str, Any],
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    try:
        resource = await replace_scim_group(
            tenant_id=principal.tenant_id,
            group_id=group_id,
            payload=body,
            base_url=base_url,
        )
    except ScimNotFoundError as exc:
        raise HTTPException(status_code=404, detail="scim_group_not_found") from exc
    except ScimConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=principal.tenant_id,
        user_id=principal.actor_id,
        resource_type="scim_group",
        resource_id=str(resource.get("id") or ""),
        details={
            "source": "scim",
            "auth_mode": principal.auth_mode,
            "display_name": resource.get("displayName"),
            "member_count": len(resource.get("members", [])),
            "operation": "replace",
        },
    )
    return resource


@app.patch("/scim/v2/Groups/{group_id}")
async def scim_patch_group_route(
    request: Request,
    group_id: str,
    body: dict[str, Any],
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    try:
        resource = await patch_scim_group(
            tenant_id=principal.tenant_id,
            group_id=group_id,
            payload=body,
            base_url=base_url,
        )
    except ScimNotFoundError as exc:
        raise HTTPException(status_code=404, detail="scim_group_not_found") from exc
    except ScimConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=principal.tenant_id,
        user_id=principal.actor_id,
        resource_type="scim_group",
        resource_id=str(resource.get("id") or ""),
        details={
            "source": "scim",
            "auth_mode": principal.auth_mode,
            "display_name": resource.get("displayName"),
            "member_count": len(resource.get("members", [])),
            "operation": "patch",
        },
    )
    return resource


@app.delete("/scim/v2/Groups/{group_id}")
async def scim_delete_group_route(
    group_id: str,
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    try:
        await delete_scim_group(tenant_id=principal.tenant_id, group_id=group_id)
    except ScimNotFoundError as exc:
        raise HTTPException(status_code=404, detail="scim_group_not_found") from exc
    await get_audit_service().log(
        event_type=AuditEventType.SYSTEM_CONFIG_UPDATE,
        tenant_id=principal.tenant_id,
        user_id=principal.actor_id,
        resource_type="scim_group",
        resource_id=group_id,
        details={"source": "scim", "auth_mode": principal.auth_mode, "operation": "delete"},
    )
    return Response(status_code=204)


@app.post("/scim/v2/Users")
async def scim_create_user_route(
    request: Request,
    body: dict[str, Any],
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    try:
        resource = await create_scim_user(
            tenant_id=principal.tenant_id,
            payload=body,
            base_url=base_url,
        )
    except ScimConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await get_audit_service().log(
        event_type=AuditEventType.USER_CREATE,
        tenant_id=principal.tenant_id,
        user_id=principal.actor_id,
        resource_type="scim_user",
        resource_id=str(resource.get("id") or ""),
        details={
            "source": "scim",
            "auth_mode": principal.auth_mode,
            "user_name": resource.get("userName"),
        },
    )
    return JSONResponse(status_code=201, content=resource)


@app.get("/scim/v2/Users/{user_id}")
async def scim_get_user_route(
    request: Request,
    user_id: str,
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    try:
        return await get_scim_user(tenant_id=principal.tenant_id, user_id=user_id, base_url=base_url)
    except ScimNotFoundError as exc:
        raise HTTPException(status_code=404, detail="scim_user_not_found") from exc


@app.put("/scim/v2/Users/{user_id}")
async def scim_replace_user_route(
    request: Request,
    user_id: str,
    body: dict[str, Any],
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    try:
        resource = await replace_scim_user(
            tenant_id=principal.tenant_id,
            user_id=user_id,
            payload=body,
            base_url=base_url,
        )
    except ScimNotFoundError as exc:
        raise HTTPException(status_code=404, detail="scim_user_not_found") from exc
    except ScimConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    event_type = AuditEventType.USER_ACTIVATE if bool(resource.get("active")) else AuditEventType.USER_DEACTIVATE
    await get_audit_service().log(
        event_type=event_type,
        tenant_id=principal.tenant_id,
        user_id=principal.actor_id,
        resource_type="scim_user",
        resource_id=str(resource.get("id") or ""),
        details={
            "source": "scim",
            "auth_mode": principal.auth_mode,
            "user_name": resource.get("userName"),
            "active": resource.get("active"),
        },
    )
    return resource


@app.patch("/scim/v2/Users/{user_id}")
async def scim_patch_user_route(
    request: Request,
    user_id: str,
    body: dict[str, Any],
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    base_url = _oidc_issuer(request)
    try:
        resource = await patch_scim_user(
            tenant_id=principal.tenant_id,
            user_id=user_id,
            payload=body,
            base_url=base_url,
        )
    except ScimNotFoundError as exc:
        raise HTTPException(status_code=404, detail="scim_user_not_found") from exc
    except ScimConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await get_audit_service().log(
        event_type=AuditEventType.USER_UPDATE,
        tenant_id=principal.tenant_id,
        user_id=principal.actor_id,
        resource_type="scim_user",
        resource_id=str(resource.get("id") or ""),
        details={
            "source": "scim",
            "auth_mode": principal.auth_mode,
            "user_name": resource.get("userName"),
            "active": resource.get("active"),
        },
    )
    return resource


@app.delete("/scim/v2/Users/{user_id}")
async def scim_delete_user_route(
    user_id: str,
    principal: ScimPrincipal = Depends(_decode_scim_principal),
):
    try:
        await delete_scim_user(tenant_id=principal.tenant_id, user_id=user_id)
    except ScimNotFoundError as exc:
        raise HTTPException(status_code=404, detail="scim_user_not_found") from exc

    await get_audit_service().log(
        event_type=AuditEventType.USER_DELETE,
        tenant_id=principal.tenant_id,
        user_id=principal.actor_id,
        resource_type="scim_user",
        resource_id=user_id,
        details={"source": "scim", "auth_mode": principal.auth_mode},
    )
    return Response(status_code=204)


@app.get("/api/v1/auth/mfa/status")
async def auth_mfa_status(current_user: UserClaims = Depends(_decode_user)):
    from auth_mfa import get_mfa_store

    status = get_mfa_store().get_status(current_user.tenant_id, current_user.sub)
    return {"ok": True, "mfa": status.to_dict(include_secret=False)}


@app.post("/api/v1/auth/mfa/setup")
async def auth_mfa_setup(current_user: UserClaims = Depends(_decode_user)):
    from auth_mfa import get_mfa_store

    status = get_mfa_store().begin_setup(current_user.tenant_id, current_user.sub)
    return {"ok": True, "mfa": status.to_dict(include_secret=True)}


@app.post("/api/v1/auth/mfa/enable")
async def auth_mfa_enable(body: MfaCodeRequest, current_user: UserClaims = Depends(_decode_user)):
    from auth_mfa import get_mfa_store

    status = get_mfa_store().enable(current_user.tenant_id, current_user.sub, body.otp_code)
    if status is None:
        await get_audit_service().log(
            event_type=AuditEventType.AUTH_MFA_VERIFY_FAILED,
            tenant_id=current_user.tenant_id,
            user_id=current_user.sub,
            resource_type="auth_mfa",
            resource_id=current_user.sub,
            details={"source": "mfa_enable"},
        )
        raise HTTPException(status_code=400, detail="invalid_mfa_code")
    await get_audit_service().log(
        event_type=AuditEventType.AUTH_MFA_ENABLED,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="auth_mfa",
        resource_id=current_user.sub,
        details={"enabled": True},
    )
    return {"ok": True, "mfa": status.to_dict(include_secret=False)}


@app.post("/api/v1/auth/mfa/disable")
async def auth_mfa_disable(body: MfaCodeRequest, current_user: UserClaims = Depends(_decode_user)):
    from auth_mfa import get_mfa_store

    store = get_mfa_store()
    if store.is_enabled(current_user.tenant_id, current_user.sub):
        verified = store.verify_code(current_user.tenant_id, current_user.sub, body.otp_code, allow_pending=False)
        if not verified:
            await get_audit_service().log(
                event_type=AuditEventType.AUTH_MFA_VERIFY_FAILED,
                tenant_id=current_user.tenant_id,
                user_id=current_user.sub,
                resource_type="auth_mfa",
                resource_id=current_user.sub,
                details={"source": "mfa_disable"},
            )
            raise HTTPException(status_code=400, detail="invalid_mfa_code")
    store.disable(current_user.tenant_id, current_user.sub)
    await get_audit_service().log(
        event_type=AuditEventType.AUTH_MFA_DISABLED,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="auth_mfa",
        resource_id=current_user.sub,
        details={"enabled": False},
    )
    return {"ok": True, "disabled": True}


@app.post("/api/v1/auth/mfa/verify")
async def auth_mfa_verify(body: MfaCodeRequest, current_user: UserClaims = Depends(_decode_user)):
    from auth_mfa import get_mfa_store

    store = get_mfa_store()
    verified = store.verify_code(current_user.tenant_id, current_user.sub, body.otp_code, allow_pending=True)
    event_type = AuditEventType.AUTH_MFA_VERIFY if verified else AuditEventType.AUTH_MFA_VERIFY_FAILED
    await get_audit_service().log(
        event_type=event_type,
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        resource_type="auth_mfa",
        resource_id=current_user.sub,
        details={"source": "mfa_verify"},
    )
    if verified:
        store.mark_verified(current_user.tenant_id, current_user.sub)
    return {"ok": True, "verified": verified}


@app.post("/api/mobile/pair/code")
async def create_mobile_pair_code(
    body: MobilePairCodeCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from mobile_pairing import get_mobile_pairing_store

    record = get_mobile_pairing_store().create_code(
        tenant_id=current_user.tenant_id,
        user_id=current_user.sub,
        roles=current_user.roles,
        ttl_sec=body.ttl_sec,
        device_hint=str(body.device_hint or "").strip() or None,
    )
    return {
        "ok": True,
        "access_code": record.access_code,
        "tenant_id": record.tenant_id,
        "user_id": record.user_id,
        "roles": record.roles,
        "expires_at": record.expires_at,
        "created_at": record.created_at,
    }


@app.post("/api/mobile/pair")
async def pair_mobile_client(body: MobilePairRequest):
    from activity_stream import ActivityType, get_activity_stream
    from mobile_pairing import get_mobile_pairing_store

    store = get_mobile_pairing_store()
    record = store.consume_code(body.access_code)
    if record is None:
        raise HTTPException(status_code=400, detail="invalid_or_expired_access_code")

    device_info = dict(body.device_info or {})
    edge_id, device_id = _build_mobile_edge_id(record.tenant_id, device_info)
    edge_secret = secrets.token_urlsafe(24)
    platform = str(device_info.get("platform") or "ios").strip().lower() or "ios"
    device_name = str(device_info.get("device_name") or device_info.get("model") or "").strip()
    app_version = str(device_info.get("app_version") or device_info.get("version") or "").strip()
    push_token = str(body.push_token or device_info.get("push_token") or "").strip()
    capabilities = {
        "camera": bool(device_info.get("camera", True)),
        "gps": bool(device_info.get("gps", True)),
        "push": bool(push_token),
    }

    device_row = store.register_device(
        device_id=device_id,
        tenant_id=record.tenant_id,
        user_id=record.user_id,
        edge_id=edge_id,
        edge_secret=edge_secret,
        platform=platform,
        device_name=device_name,
        app_version=app_version,
        push_token=push_token,
        capabilities=capabilities,
    )

    edge_registry = _edge_registry_map()
    edge_registry[edge_id] = {
        "edge_id": edge_id,
        "user_id": record.user_id,
        "tenant_id": record.tenant_id,
        "account_id": device_id,
        "webhook_url": None,
        "skills": [],
        "skill_manifest_path": None,
        "skill_commands": [],
        "skill_manifest_meta": {
            "node_type": "mobile",
            "platform": platform,
            "device_name": device_name,
            "app_version": app_version,
            "capabilities": capabilities,
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }

    get_edge_twin_manager().ensure_desired_state(
        edge_id,
        record.tenant_id,
        defaults={
            "lobster_configs": {},
            "skill_versions": {},
            "max_concurrent_tasks": 1,
            "log_level": "INFO",
            "feature_flags": {"mobile_pairing": True},
        },
    )
    consent = edge_resource_upsert_consent(
        edge_id=edge_id,
        user_id=record.user_id,
        tenant_id=record.tenant_id,
        consent_version="mobile_v1",
        accepted=True,
        ip_share_enabled=False,
        compute_share_enabled=False,
        otp_relay_enabled=False,
        operator=record.user_id,
        notes="mobile.pair",
    )
    await get_activity_stream().record_edge_state(
        tenant_id=record.tenant_id,
        edge_id=edge_id,
        user_id=record.user_id,
        activity_type=ActivityType.EDGE_NODE_ENROLLED,
        details={
            "account_id": device_id,
            "node_type": "mobile",
            "platform": platform,
            "device_name": device_name,
        },
    )

    edge_auth = _load_edge_auth_module().EdgeAuthManager(edge_id, edge_secret, record.tenant_id).generate(
        include_legacy_secret=False,
    )
    client_token = _create_access_token(record.user_id, record.tenant_id, record.roles or ["member"])
    return {
        "ok": True,
        "client_token": client_token.access_token,
        "token_type": client_token.token_type,
        "expires_in": client_token.expires_in,
        "tenant_id": record.tenant_id,
        "user_id": record.user_id,
        "edge": edge_registry[edge_id],
        "device": asdict(device_row),
        "consent": consent,
        "edge_auth": {
            "mode": "hmac_v1_mobile",
            "edge_id": edge_id,
            "edge_secret": edge_secret,
            "socket_auth": edge_auth.to_socket_auth(),
            "headers": edge_auth.to_headers(),
        },
    }


@app.post("/api/notify/push")
async def send_mobile_push_facade(
    body: MobilePushRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    from mobile_pairing import get_mobile_pairing_store

    target_tenant = str(body.tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")

    store = get_mobile_pairing_store()
    queued: list[dict[str, Any]] = []
    if body.push_token:
        queued.append(
            store.enqueue_push(
                tenant_id=target_tenant,
                user_id=body.user_id,
                edge_id=body.edge_id,
                title=body.title,
                body=body.body,
                data=body.data,
                push_token=body.push_token,
            )
        )
    else:
        devices = store.list_devices(
            tenant_id=target_tenant,
            user_id=str(body.user_id or "").strip() or None,
        )
        if body.edge_id:
            devices = [item for item in devices if str(item.get("edge_id") or "") == str(body.edge_id).strip()]
        for item in devices:
            queued.append(
                store.enqueue_push(
                    tenant_id=target_tenant,
                    user_id=str(item.get("user_id") or "") or body.user_id,
                    edge_id=str(item.get("edge_id") or "") or body.edge_id,
                    title=body.title,
                    body=body.body,
                    data=body.data,
                    push_token=str(item.get("push_token") or ""),
                )
            )
        if not queued:
            queued.append(
                store.enqueue_push(
                    tenant_id=target_tenant,
                    user_id=body.user_id,
                    edge_id=body.edge_id,
                    title=body.title,
                    body=body.body,
                    data=body.data,
                    push_token="",
                )
            )
    return {"ok": True, "queued": len(queued), "items": queued}


@app.get("/billing/subscription/me")
async def billing_subscription_me(
    user_id: str | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = user_id or current_user.sub
    effective_tenant = tenant_id or current_user.tenant_id
    if current_user.sub != effective_user and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    subscription = await ensure_subscription(effective_user, effective_tenant)
    return {"ok": True, "subscription": subscription}


@app.get("/billing/plans")
async def billing_plans(current_user: UserClaims = Depends(_decode_user)):
    return {
        "ok": True,
        "plans": {
            "free": {
                "token_limit": int(os.getenv("PLAN_FREE_TOKEN_LIMIT", "300000")),
                "run_limit": int(os.getenv("PLAN_FREE_RUN_LIMIT", "120")),
                "price_month_cny": 0,
                "price_year_cny": 0,
            },
            "pro": {
                "token_limit": int(os.getenv("PLAN_PRO_TOKEN_LIMIT", "10000000")),
                "run_limit": int(os.getenv("PLAN_PRO_RUN_LIMIT", "3000")),
                "price_month_cny": int(os.getenv("PLAN_PRO_PRICE_MONTH_CNY", "499")),
                "price_year_cny": int(os.getenv("PLAN_PRO_PRICE_YEAR_CNY", "4990")),
            },
            "enterprise": {
                "token_limit": int(os.getenv("PLAN_ENTERPRISE_TOKEN_LIMIT", "100000000")),
                "run_limit": int(os.getenv("PLAN_ENTERPRISE_RUN_LIMIT", "50000")),
                "price_month_cny": int(os.getenv("PLAN_ENTERPRISE_PRICE_MONTH_CNY", "4999")),
                "price_year_cny": int(os.getenv("PLAN_ENTERPRISE_PRICE_YEAR_CNY", "49990")),
            },
        },
        "user": {"user_id": current_user.sub, "tenant_id": current_user.tenant_id, "roles": current_user.roles},
    }


@app.get("/billing/usage/summary")
async def billing_usage_summary(
    user_id: str | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    from_ts: str | None = Query(default=None),
    to_ts: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = user_id or current_user.sub
    effective_tenant = tenant_id or current_user.tenant_id
    if current_user.sub != effective_user and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    summary = await usage_summary(
        user_id=effective_user,
        tenant_id=effective_tenant,
        from_ts=_parse_dt(from_ts),
        to_ts=_parse_dt(to_ts),
    )
    return {"ok": True, "summary": summary}


@app.post("/billing/usage/report")
async def billing_usage_report(
    body: UsageReportRequest,
    user_id: str | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = user_id or current_user.sub
    effective_tenant = tenant_id or current_user.tenant_id
    if current_user.sub != effective_user and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    row = await report_usage(
        user_id=effective_user,
        tenant_id=effective_tenant,
        event_type=body.event_type,
        path=body.path,
        runs=body.runs,
        tokens=body.tokens,
        trace_id=body.trace_id,
        metadata=body.metadata,
    )
    return {"ok": True, "usage": row}


@app.get("/billing/providers/status")
async def billing_providers_status(current_user: UserClaims = Depends(_decode_user)):
    return {
        "ok": True,
        "user": {"user_id": current_user.sub, "tenant_id": current_user.tenant_id, "roles": current_user.roles},
        "providers": payment_gateway.provider_health(),
    }


@app.get("/billing/orders")
async def billing_orders(
    user_id: str | None = Query(default=None),
    tenant_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = user_id or current_user.sub
    effective_tenant = tenant_id or current_user.tenant_id
    if current_user.sub != effective_user and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    rows = await list_orders(user_id=effective_user, tenant_id=effective_tenant, limit=limit)
    return {"ok": True, "count": len(rows), "orders": rows}


@app.post("/billing/trial/activate")
async def billing_trial_activate(
    body: BillingTrialActivateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = body.user_id or current_user.sub
    effective_tenant = body.tenant_id or current_user.tenant_id
    if current_user.sub != effective_user and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    try:
        subscription = await activate_trial(
            user_id=effective_user,
            tenant_id=effective_tenant,
            plan_code=body.plan_code,
            duration_days=body.duration_days,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True, "subscription": subscription}


@app.get("/billing/webhook/events")
async def billing_webhook_events(
    tenant_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    rows = await billing_list_webhook_events(tenant_id=effective_tenant, limit=limit)
    return {"ok": True, "count": len(rows), "items": rows}


@app.get("/billing/compensation")
async def billing_compensation(
    tenant_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    rows = await list_compensation_tasks(tenant_id=effective_tenant, status=status, limit=limit)
    return {"ok": True, "count": len(rows), "items": rows}


@app.post("/billing/compensation/{task_id}/resolve")
async def billing_compensation_resolve(
    task_id: str,
    body: BillingCompensationResolveRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    row = await resolve_compensation_task(task_id=task_id, status=body.status, notes=body.notes)
    if row is None:
        raise HTTPException(status_code=404, detail="compensation task not found")
    return {"ok": True, "task": row}


@app.post("/billing/reconcile/run")
async def billing_reconcile_run(
    body: BillingReconcileRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    row = await run_reconciliation(
        provider=body.provider or payment_gateway.default_provider,
        tenant_id=body.tenant_id,
        stale_minutes=body.stale_minutes,
        lookback_days=body.lookback_days,
    )
    return {"ok": True, "reconciliation": row}


@app.post("/billing/checkout")
async def billing_checkout(
    body: BillingCheckoutIntentRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = body.user_id or current_user.sub
    effective_tenant = body.tenant_id or current_user.tenant_id
    if current_user.sub != effective_user and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")

    safe_plan, safe_cycle, amount_cny = _billing_plan_amount_cny(body.plan_code, body.cycle)
    intent = payment_gateway.create_checkout_intent(
        user_id=effective_user,
        tenant_id=effective_tenant,
        plan_code=safe_plan,
        cycle=safe_cycle,
        amount_cny=amount_cny,
        provider=body.provider,
        return_url=body.return_url,
    )
    order = await create_checkout_order(
        order_id=intent.order_id,
        checkout_id=intent.checkout_id,
        user_id=effective_user,
        tenant_id=effective_tenant,
        plan_code=safe_plan,
        cycle=safe_cycle,
        payment_provider=intent.provider,
        amount_cny=amount_cny,
        currency=intent.currency,
        status=intent.status,
        return_url=body.return_url,
        metadata=intent.metadata,
    )

    return {
        "ok": True,
        "checkout": intent.as_dict(),
        "order": order,
    }


@app.post("/billing/webhook")
async def billing_provider_webhook(
    request: Request,
    body: BillingProviderWebhookRequest,
    x_payment_provider: str | None = Header(default=None, alias="x-payment-provider"),
    x_payment_signature: str | None = Header(default=None, alias="x-payment-signature"),
    x_signature: str | None = Header(default=None, alias="x-signature"),
):
    provider = x_payment_provider or body.provider or os.getenv("PAYMENT_PROVIDER", "stripe")
    signature = x_payment_signature or x_signature or body.signature

    raw_text = (await request.body()).decode("utf-8", errors="ignore")
    payload = body.payload if isinstance(body.payload, dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    effective_user = str(body.user_id or payload.get("user_id") or metadata.get("user_id") or "webhook_user").strip()
    effective_tenant = str(body.tenant_id or payload.get("tenant_id") or metadata.get("tenant_id") or "tenant_main").strip()
    effective_order_id = str(body.order_id or body.checkout_id or payload.get("order_id") or metadata.get("order_id") or "").strip()
    effective_plan_code = str(metadata.get("plan_code") or payload.get("plan_code") or "").strip()
    effective_cycle = str(metadata.get("cycle") or payload.get("cycle") or "").strip()
    provider_subscription_id = str(
        body.provider_subscription_id
        or payload.get("provider_subscription_id")
        or payload.get("subscription_id")
        or payload.get("id")
        or ""
    ).strip()[:128]
    requested_action = body.action or str(payload.get("action") or payload.get("event_type") or "").strip()
    action = _billing_map_provider_event_to_action(requested_action, fallback_plan_code=str(metadata.get("plan_code") or "pro"))
    event_id = body.event_id or str(payload.get("event_id") or payload.get("id") or "").strip()

    decision = payment_gateway.verify_webhook(
        provider=provider,
        body_raw=raw_text,
        signature=signature,
        event_id=event_id or None,
        action=action,
        payload=payload,
    )
    if not decision.ok:
        event_row = await record_webhook_event(
            provider=decision.provider,
            event_id=decision.event_id,
            action=decision.action,
            payload=decision.payload,
            processed_ok=False,
            reason=decision.reason,
            result={"status": "rejected"},
            user_id=effective_user,
            tenant_id=effective_tenant,
            order_id=effective_order_id or None,
        )
        raise HTTPException(status_code=401, detail={"code": "invalid_webhook", "reason": decision.reason, "event": event_row})

    event_row = await record_webhook_event(
        provider=decision.provider,
        event_id=decision.event_id,
        action=decision.action,
        payload=decision.payload,
        processed_ok=True,
        reason=decision.reason,
        result={"status": "accepted"},
        user_id=effective_user,
        tenant_id=effective_tenant,
        order_id=effective_order_id or None,
    )
    if event_row.get("already_recorded"):
        return {
            "ok": True,
            "duplicate": True,
            "provider": decision.provider,
            "event_id": decision.event_id,
            "action": decision.action,
            "event": event_row,
        }

    updated = await apply_provider_webhook_event(
        user_id=effective_user,
        tenant_id=effective_tenant,
        action=decision.action,
        plan_code=effective_plan_code or None,
        cycle=effective_cycle or None,
        provider_subscription_id=provider_subscription_id or None,
        payment_provider=decision.provider,
    )
    order_row = None
    if effective_order_id:
        order_row = await update_order_after_webhook(
            order_id=effective_order_id,
            action=decision.action,
            payment_provider=decision.provider,
            event_id=decision.event_id,
            provider_subscription_id=provider_subscription_id or None,
        )
        if decision.action in {"payment_failed", "past_due", "cancel", "canceled"} and order_row is not None:
            await enqueue_compensation_task(
                order_id=effective_order_id,
                user_id=effective_user,
                tenant_id=effective_tenant,
                reason_code=decision.action,
                detail={"event_id": decision.event_id, "provider": decision.provider},
            )
    _remember_event(
        user_id=effective_user,
        trace_id=event_id or None,
        node="billing.webhook",
        event_type=decision.action,
        payload={
            "provider": decision.provider,
            "event_id": decision.event_id,
            "tenant_id": effective_tenant,
            "subscription_id": provider_subscription_id,
            "status": updated.get("status"),
            "plan_code": updated.get("plan_code"),
        },
        level="warning",
    )
    return {
        "ok": True,
        "provider": decision.provider,
        "event_id": decision.event_id,
        "action": decision.action,
        "subscription": updated,
        "event": event_row,
        "order": order_row,
    }


@app.get("/billing/seats/plans")
async def billing_seat_plans(current_user: UserClaims = Depends(_decode_user)):
    from saas_pricing_model import FLOOR_PRICE, SEAT_PRICE_TIERS, get_seat_total_price

    tiers = [
        {
            "min_seats": int(min_seats),
            "max_seats": int(max_seats),
            "unit_price": int(price),
            "floor_price": int(FLOOR_PRICE),
            "pricing": get_seat_total_price(max(1, min_seats), billing_cycle="monthly"),
        }
        for min_seats, max_seats, price in SEAT_PRICE_TIERS
    ]
    return {"ok": True, "tiers": tiers, "tenant_id": current_user.tenant_id}


@app.get("/billing/seats/subscription")
async def billing_seat_subscription(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = tenant_id or current_user.tenant_id
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    sub = await get_seat_billing_service().get_subscription(tenant_id=effective_tenant)
    return {"ok": True, "subscription": sub}


@app.post("/billing/seats/subscription")
async def billing_seat_create_subscription(
    body: SeatSubscriptionCreateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = body.tenant_id or current_user.tenant_id
    if current_user.tenant_id != effective_tenant and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    sub = await get_seat_billing_service().create_subscription(
        tenant_id=effective_tenant,
        seat_count=body.seat_count,
        billing_cycle=body.billing_cycle,
        agent_id=body.agent_id,
        trial_days=body.trial_days,
    )
    return {"ok": True, "subscription": sub}


@app.post("/billing/seats/subscription/{subscription_id}/checkout")
async def billing_seat_checkout(
    subscription_id: str,
    body: SeatSubscriptionCheckoutRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    sub = await get_seat_billing_service().get_subscription(subscription_id=subscription_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="subscription not found")
    if current_user.tenant_id != str(sub.get("tenant_id") or "") and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    payload = await get_seat_billing_service().create_checkout(
        subscription_id=subscription_id,
        provider=body.provider,
        return_url=body.return_url,
    )
    return {"ok": True, **payload}


@app.post("/billing/seats/subscription/{subscription_id}/upgrade")
async def billing_seat_upgrade(
    subscription_id: str,
    body: SeatSubscriptionUpgradeRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    sub = await get_seat_billing_service().get_subscription(subscription_id=subscription_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="subscription not found")
    if current_user.tenant_id != str(sub.get("tenant_id") or "") and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    payload = await get_seat_billing_service().upgrade_seats(
        tenant_id=str(sub.get("tenant_id") or current_user.tenant_id),
        new_seat_count=body.new_seat_count,
    )
    return {"ok": True, **payload}


@app.post("/billing/seats/webhook")
async def billing_seat_webhook(body: BillingProviderWebhookRequest):
    payload = body.payload if isinstance(body.payload, dict) else {}
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    subscription_id = str(payload.get("subscription_id") or metadata.get("subscription_id") or "").strip()
    checkout_id = str(body.checkout_id or payload.get("checkout_id") or "").strip() or None
    action = str(body.action or payload.get("action") or "payment_succeeded").strip().lower()
    provider = str(body.provider or payload.get("provider") or "wechatpay").strip() or "wechatpay"
    if action in {"payment_failed", "past_due"}:
        tenant_hint = str(body.tenant_id or payload.get("tenant_id") or metadata.get("tenant_id") or "tenant_main").strip() or "tenant_main"
        sub = await get_seat_billing_service().handle_payment_failed(tenant_id=tenant_hint)
        return {"ok": True, "subscription": sub}
    sub = await get_seat_billing_service().mark_subscription_paid(
        subscription_id=subscription_id or None,
        checkout_id=checkout_id,
        provider=provider,
    )
    return {"ok": True, "subscription": sub}


@app.get("/billing/seats/quotas/{tenant_id}")
async def billing_seat_quota_summary(tenant_id: str, current_user: UserClaims = Depends(_decode_user)):
    if current_user.tenant_id != tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    summary = await get_seat_quota_tracker().get_tenant_usage_summary(tenant_id)
    return {"ok": True, "summary": summary}


@app.post("/billing/seats/quotas/consume")
async def billing_seat_quota_consume(
    body: SeatQuotaConsumeRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    try:
        summary = await get_seat_quota_tracker().consume(
            SeatQuotaMutation(
                seat_id=body.seat_id,
                tenant_id=current_user.tenant_id,
                resource=body.resource,
                amount=body.amount,
                trace_id=body.trace_id or "",
                source=body.source,
            )
        )
    except SeatQuotaExceededError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True, "seat": summary}


@app.post("/partner/register")
async def partner_register(
    body: PartnerAgentRegisterRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    profile = get_regional_agent_manager().register_reseller_agent(
        company_name=body.company_name,
        contact_name=body.contact_name,
        contact_phone=body.contact_phone,
        contact_wechat=body.contact_wechat or "",
        city=body.city,
        province=body.province,
        seat_count=body.seat_count,
        white_label_brand_name=body.white_label_brand_name or "",
    )
    return {"ok": True, "agent": profile}


@app.get("/partner/dashboard")
async def partner_dashboard(agent_id: str = Query(..., min_length=1), current_user: UserClaims = Depends(_decode_user)):
    try:
        dashboard = await get_regional_agent_manager().build_dashboard(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "dashboard": dashboard}


@app.get("/partner/seats")
async def partner_seats(agent_id: str = Query(..., min_length=1), current_user: UserClaims = Depends(_decode_user)):
    try:
        seats = await get_regional_agent_manager().list_agent_seats_detailed(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "items": seats}


@app.post("/partner/seats/assign")
async def partner_assign_seat(
    body: PartnerSeatAssignRequest,
    agent_id: str = Query(..., min_length=1),
    current_user: UserClaims = Depends(_decode_user),
):
    try:
        seat = await get_regional_agent_manager().assign_seat_to_agent(
            agent_id=agent_id,
            seat_id=body.seat_id,
            tenant_id=body.tenant_id,
            seat_name=body.seat_name,
            platform=body.platform,
            account_username=body.account_username,
            client_name=body.client_name,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "seat": seat}


@app.post("/partner/upgrade")
async def partner_upgrade(
    body: PartnerSeatUpgradeRequest,
    agent_id: str = Query(..., min_length=1),
    current_user: UserClaims = Depends(_decode_user),
):
    try:
        payload = get_regional_agent_manager().set_purchased_seats(agent_id, body.seat_count)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, **payload}


@app.get("/partner/white-label")
async def partner_white_label(agent_id: str = Query(..., min_length=1), current_user: UserClaims = Depends(_decode_user)):
    try:
        dashboard = await get_regional_agent_manager().build_dashboard(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "config": dashboard.get("white_label", {})}


@app.put("/partner/white-label")
async def partner_white_label_update(
    body: PartnerWhiteLabelUpdateRequest,
    agent_id: str = Query(..., min_length=1),
    current_user: UserClaims = Depends(_decode_user),
):
    try:
        config = get_regional_agent_manager().save_white_label_config(
            agent_id,
            brand_name=body.brand_name,
            logo_url=body.logo_url or "",
            primary_color=body.primary_color,
            lobster_names=body.lobster_names,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "config": config}


@app.post("/partner/sub-agents")
async def partner_create_sub_agent(
    body: PartnerSubAgentCreateRequest,
    agent_id: str = Query(..., min_length=1),
    current_user: UserClaims = Depends(_decode_user),
):
    try:
        row = get_regional_agent_manager().create_sub_agent(
            parent_agent_id=agent_id,
            company_name=body.company_name,
            contact_name=body.contact_name,
            region=body.region,
            allocated_seats=body.allocated_seats,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "sub_agent": row}


@app.get("/partner/sub-agents/tree")
async def partner_sub_agent_tree(agent_id: str = Query(..., min_length=1), current_user: UserClaims = Depends(_decode_user)):
    try:
        tree = get_regional_agent_manager().get_sub_agent_tree(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "tree": tree}


@app.get("/partner/statements")
async def partner_statements(
    agent_id: str = Query(..., min_length=1),
    current_user: UserClaims = Depends(_decode_user),
):
    items = get_agent_commission_service().list_statements(agent_id)
    return {"ok": True, "items": items}


@app.get("/partner/statements/{period}")
async def partner_statement_detail(
    period: str,
    agent_id: str = Query(..., min_length=1),
    current_user: UserClaims = Depends(_decode_user),
):
    stmt = get_agent_commission_service().get_statement(agent_id, period)
    if stmt is None:
        raise HTTPException(status_code=404, detail="statement not found")
    return {"ok": True, "statement": stmt.to_dict()}


@app.post("/partner/statements/{period}/confirm")
async def partner_statement_confirm(
    period: str,
    body: PartnerStatementConfirmRequest,
    agent_id: str = Query(..., min_length=1),
    current_user: UserClaims = Depends(_decode_user),
):
    try:
        row = await get_agent_commission_service().agent_confirm_statement(agent_id, period, body.confirmed_by)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "statement": row}


@app.post("/partner/statements/{period}/dispute")
async def partner_statement_dispute(
    period: str,
    body: PartnerStatementDisputeRequest,
    agent_id: str = Query(..., min_length=1),
    current_user: UserClaims = Depends(_decode_user),
):
    try:
        row = await get_agent_commission_service().dispute_statement(agent_id, period, body.reason)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "statement": row}


@app.get("/partner/profit-forecast")
async def partner_profit_forecast(
    agent_id: str = Query(..., min_length=1),
    current_user: UserClaims = Depends(_decode_user),
):
    try:
        forecast = await get_agent_commission_service().profit_forecast(agent_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"ok": True, "forecast": forecast}


@app.post("/admin/settlement/trigger")
async def admin_settlement_trigger(
    period: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    result = await get_agent_commission_service().batch_calculate_all_agents(period=period)
    return {"ok": True, "result": result}


@app.get("/llm/vllm/roi")
async def llm_vllm_roi(seat_count: int = Query(..., ge=1, le=100000), current_user: UserClaims = Depends(_decode_user)):
    return {"ok": True, "analysis": vllm_roi_analysis(seat_count)}


@app.get("/llm/vllm/status")
async def llm_vllm_status(current_user: UserClaims = Depends(_decode_user)):
    router = get_hybrid_llm_router()
    total_seats = await router.refresh_total_seats()
    healthy = await router.vllm.health_check()
    return {
        "ok": True,
        "status": {
            "total_seats": total_seats,
            "healthy": healthy,
            "base_url": router.vllm.base_url,
            "model": router.vllm.model,
        },
    }


@app.get("/media/cost/estimate")
async def media_cost_estimate(seat_count: int = Query(..., ge=1, le=100000), current_user: UserClaims = Depends(_decode_user)):
    return {"ok": True, "estimate": get_media_cost_optimizer().estimate_monthly_cost(seat_count)}

@app.post("/edge/register")
async def register_edge(
    body: EdgeRegisterRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if current_user.sub != body.user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    from activity_stream import ActivityType, get_activity_stream

    app.state.edge_registry[body.edge_id] = {
        "edge_id": body.edge_id,
        "user_id": body.user_id,
        "tenant_id": current_user.tenant_id,
        "account_id": body.account_id,
        "webhook_url": body.webhook_url,
        "skills": _normalize_skills(body.skills),
        "skill_manifest_path": body.skill_manifest_path,
        "skill_commands": _normalize_commands(body.skill_commands),
        "skill_manifest_meta": body.skill_manifest_meta,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    get_edge_twin_manager().ensure_desired_state(
        body.edge_id,
        current_user.tenant_id,
        defaults={
            "lobster_configs": {},
            "skill_versions": {
                skill_id: {"version": "bootstrap"}
                for skill_id in _normalize_skills(body.skills)
            },
            "max_concurrent_tasks": 3,
            "log_level": "INFO",
            "feature_flags": {"offline_mode": True, "auto_upgrade": True},
        },
    )
    consent = edge_resource_upsert_consent(
        edge_id=body.edge_id,
        user_id=body.user_id,
        tenant_id=current_user.tenant_id,
        consent_version=body.consent_version,
        accepted=body.consent_accepted,
        ip_share_enabled=body.ip_share_enabled,
        compute_share_enabled=body.compute_share_enabled,
        otp_relay_enabled=body.otp_relay_enabled,
        operator=current_user.sub,
        notes="edge.register",
    )
    _remember_event(
        user_id=body.user_id,
        trace_id=None,
        node="edge.register",
        event_type="registered",
        payload={
            "edge_id": body.edge_id,
            "consent_status": consent.get("status"),
            "ip_share_enabled": bool(consent.get("ip_share_enabled")),
            "compute_share_enabled": bool(consent.get("compute_share_enabled")),
        },
        level="warning",
    )
    await get_activity_stream().record_edge_state(
        tenant_id=current_user.tenant_id,
        edge_id=body.edge_id,
        user_id=body.user_id,
        activity_type=ActivityType.EDGE_NODE_ENROLLED,
        details={
            "account_id": body.account_id,
            "skills": _normalize_skills(body.skills),
            "consent_status": consent.get("status"),
        },
    )
    return {
        "ok": True,
        "edge": app.state.edge_registry[body.edge_id],
        "consent": consent,
        "auth": {
            "mode": "hmac_v1",
            "legacy_header_supported": True,
            "header_fields": ["X-Edge-Node-Id", "X-Timestamp", "X-Nonce", "X-Signature"],
        },
    }


@app.get("/edge/pull/{edge_id}", response_model=EdgePullResponse, dependencies=[Depends(_verify_edge_secret)])
async def pull_edge_packages(
    edge_id: str,
    limit: int = Query(default=5, ge=1, le=100),
):
    outbox_manager = _edge_outbox_manager()
    if outbox_manager is not None:
        items = await outbox_manager.pull_batch(edge_id, limit=limit)
        return EdgePullResponse(edge_id=edge_id, count=len(items), packages=items)
    queue = app.state.edge_outbox.setdefault(edge_id, [])
    items = queue[:limit]
    del queue[:limit]
    return EdgePullResponse(edge_id=edge_id, count=len(items), packages=items)


@app.post("/edge/ack/{outbox_id}", dependencies=[Depends(_verify_edge_secret)])
async def ack_edge_package(outbox_id: str, body: EdgeAckRequest | None = None):
    outbox_manager = _edge_outbox_manager()
    if outbox_manager is None:
        return {"ok": False, "detail": "edge_outbox_manager_unavailable"}
    acknowledged = await outbox_manager.ack(outbox_id)
    return {
        "ok": acknowledged,
        "outbox_id": outbox_id,
        "edge_id": (body.edge_id if body else None),
    }


@app.post("/edge/snapshots/report", dependencies=[Depends(_verify_edge_secret)])
async def edge_snapshot_report(body: dict[str, Any]):
    report = dict(body or {})
    stored = get_snapshot_audit_store().store_report(report)
    return {"ok": True, "snapshot": stored}


@app.get("/api/v1/snapshots")
async def list_execution_snapshots(
    tenant_id: str | None = Query(default=None),
    node_id: str | None = Query(default=None),
    account_id: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = str(tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    items = get_snapshot_audit_store().list_snapshots(
        tenant_id=effective_tenant,
        node_id=node_id,
        account_id=account_id,
        status=status,
        limit=limit,
    )
    return {"ok": True, "count": len(items), "items": items}


@app.get("/api/v1/snapshots/{snapshot_id}")
async def get_execution_snapshot_detail(
    snapshot_id: str,
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = str(tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    snapshot = get_snapshot_audit_store().get_snapshot(snapshot_id, tenant_id=effective_tenant)
    if snapshot is None:
        raise HTTPException(status_code=404, detail="snapshot_not_found")
    return {"ok": True, "snapshot": snapshot}


@app.get("/api/v1/snapshots/{snapshot_id}/replay")
async def get_execution_snapshot_replay(
    snapshot_id: str,
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_tenant = str(tenant_id or current_user.tenant_id).strip() or current_user.tenant_id
    if effective_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant_id")
    replay = get_snapshot_audit_store().get_replay(snapshot_id, tenant_id=effective_tenant)
    if replay is None:
        raise HTTPException(status_code=404, detail="snapshot_not_found")
    return {"ok": True, **replay}


def _resolve_edge_owner(edge_id: str, user_id_hint: str | None = None) -> tuple[str, str, dict[str, Any]]:
    registry = _edge_registry_map()
    row = registry.get(edge_id, {})
    user_id = str(user_id_hint or row.get("user_id") or "user").strip() or "user"
    tenant_id = str(row.get("tenant_id") or "tenant_main").strip() or "tenant_main"
    return user_id, tenant_id, row


@app.post("/edge/heartbeat", dependencies=[Depends(_verify_edge_secret)])
async def edge_heartbeat(body: EdgeHeartbeatRequest):
    from activity_stream import ActivityType, get_activity_stream

    now_iso = datetime.now(timezone.utc).isoformat()
    registry = _edge_registry_map()
    user_id, tenant_id, row = _resolve_edge_owner(body.edge_id, body.user_id)
    previous_status = str((registry.get(body.edge_id) or {}).get("status") or "").strip().lower()

    # ── CapacityWake：注册/心跳同步到 BridgeProtocolManager ──────────
    try:
        from bridge_protocol import get_bridge_manager
        _bm = get_bridge_manager()
        _capabilities = list(row.get("skills") or []) or ["content_publish"]
        if body.edge_id not in _bm.capacity_wake._edge_metadata:
            _bm.capacity_wake.register_edge(
                body.edge_id,
                tenant_id=tenant_id,
                capabilities=_capabilities,
            )
        else:
            _bm.capacity_wake.heartbeat(body.edge_id)
        await _bm.process_edge_message(
            {
                "msg_id": f"node_ping_{uuid.uuid4().hex[:10]}",
                "msg_type": "node_ping",
                "tenant_id": tenant_id,
                "node_id": body.edge_id,
                "account_id": body.account_id or row.get("account_id"),
                "payload": {
                    "status": body.status,
                    "cpu_percent": body.cpu_percent,
                    "memory_percent": body.memory_percent,
                    "memory_usage_mb": body.memory_usage_mb,
                    "skills": row.get("skills", []),
                    "pending_task_count": body.pending_task_count,
                    "running_task_count": body.running_task_count,
                    "max_concurrent_tasks": body.max_concurrent_tasks,
                    "log_level": body.log_level,
                    "meta_cache_status": body.meta_cache_status,
                    "edge_version": body.edge_version,
                    "reported_resource_version": body.reported_resource_version,
                },
                "timestamp": time.time(),
            }
        )
    except Exception:
        pass

    merged = {
        "edge_id": body.edge_id,
        "user_id": user_id,
        "tenant_id": tenant_id,
        "account_id": body.account_id or row.get("account_id"),
        "status": body.status,
        "webhook_url": row.get("webhook_url"),
        "skills": row.get("skills", []),
        "skill_manifest_path": row.get("skill_manifest_path"),
        "skill_commands": row.get("skill_commands", []),
        "skill_manifest_meta": row.get("skill_manifest_meta", {}),
        "cpu_percent": body.cpu_percent,
        "memory_percent": body.memory_percent,
        "memory_usage_mb": body.memory_usage_mb,
        "ip_hash": body.ip_hash,
        "updated_at": now_iso,
    }
    twin_mgr = get_edge_twin_manager()
    diff = twin_mgr.update_actual_state(
        EdgeActualState(
            edge_id=body.edge_id,
            tenant_id=tenant_id,
            lobster_configs=dict(body.lobster_configs or {}),
            skill_versions=dict(body.skill_versions or {}),
            pending_task_count=int(body.pending_task_count or 0),
            running_task_count=int(body.running_task_count or 0),
            max_concurrent_tasks=int(body.max_concurrent_tasks or 0),
            log_level=str(body.log_level or "INFO"),
            cpu_usage_pct=float(body.cpu_percent or 0.0),
            memory_usage_mb=int(body.memory_usage_mb or 0),
            is_online=str(body.status or "").lower() != "offline",
            meta_cache_status=str(body.meta_cache_status or "cold"),
            edge_version=str(body.edge_version or ""),
            reported_resource_version=int(body.reported_resource_version or 0),
            last_heartbeat_at=now_iso,
            reported_at=now_iso,
        )
    )
    desired = twin_mgr.get_desired_state(body.edge_id)
    merged.update(
        {
            "lobster_configs": dict(body.lobster_configs or {}),
            "skill_versions": dict(body.skill_versions or {}),
            "pending_task_count": int(body.pending_task_count or 0),
            "running_task_count": int(body.running_task_count or 0),
            "max_concurrent_tasks": int(body.max_concurrent_tasks or 0),
            "log_level": str(body.log_level or "INFO"),
            "meta_cache_status": str(body.meta_cache_status or "cold"),
            "edge_version": str(body.edge_version or ""),
            "reported_resource_version": int(body.reported_resource_version or 0),
            "twin_synced": not diff.has_diff,
            "pending_config_updates": len(diff.config_diffs),
            "pending_skill_updates": len(diff.skill_diffs),
            "config_version_summary": ",".join(
                f"{k}:{v}" for k, v in sorted((body.lobster_configs or {}).items())
            )[:500],
            "skill_version_summary": ",".join(
                f"{k}:{v}" for k, v in sorted((body.skill_versions or {}).items())
            )[:500],
            "desired_resource_version": int((desired.resource_version if desired else 0) or 0),
        }
    )
    registry[body.edge_id] = merged
    if _edge_outbox_manager() is None:
        app.state.edge_outbox.setdefault(body.edge_id, [])
    current_status = str(body.status or "").strip().lower()
    if current_status == "offline" and previous_status != "offline":
        await get_activity_stream().record_edge_state(
            tenant_id=tenant_id,
            edge_id=body.edge_id,
            user_id=user_id,
            activity_type=ActivityType.EDGE_NODE_OFFLINE,
            details={"previous_status": previous_status, "current_status": current_status},
        )
    elif previous_status and current_status and previous_status != current_status:
        await get_activity_stream().record_edge_state(
            tenant_id=tenant_id,
            edge_id=body.edge_id,
            user_id=user_id,
            activity_type=ActivityType.EDGE_NODE_UPDATED,
            details={"previous_status": previous_status, "current_status": current_status},
        )

    reward = edge_reward_report_heartbeat(
        edge_id=body.edge_id,
        user_id=user_id,
        tenant_id=tenant_id,
        account_id=merged.get("account_id"),
        status=body.status,
        ip_hash=body.ip_hash,
        cpu_percent=body.cpu_percent,
        memory_percent=body.memory_percent,
    )
    _remember_event(
        user_id=user_id,
        trace_id=None,
        node="edge.heartbeat",
        event_type="reported",
        payload={
            "edge_id": body.edge_id,
            "status": body.status,
            "cpu_percent": body.cpu_percent,
            "memory_percent": body.memory_percent,
            "points_gain": reward.get("points_gain", 0),
            "delta_online_seconds": reward.get("delta_online_seconds", 0),
        },
        level="warning",
    )
    rule_event = {
        "event": {"type": "edge_heartbeat"},
        "edge": {
            "edge_id": body.edge_id,
            "status": str(body.status or "").lower(),
            "cpu_percent": float(body.cpu_percent or 0.0),
            "memory_percent": float(body.memory_percent or 0.0),
            "pending_task_count": int(body.pending_task_count or 0),
            "running_task_count": int(body.running_task_count or 0),
        },
    }
    triggered_rules: list[dict[str, Any]] = []
    try:
        triggered_rules = await _get_lobster_rule_engine().process(rule_event, tenant_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Rule engine skipped on edge heartbeat: %s", exc)
    return {
        "ok": True,
        "edge": merged,
        "reward": reward,
        "wallet": reward.get("wallet_after", {}),
        "triggered_rules": triggered_rules,
        "consent": edge_resource_get_consent(body.edge_id),
        "twin": {
            "is_synced": not diff.has_diff,
            "diff": diff.to_dict(),
            "desired": desired.to_dict() if desired else None,
            "actual": twin_mgr.get_actual_state(body.edge_id).to_dict() if twin_mgr.get_actual_state(body.edge_id) else None,
            "sync_payload": twin_mgr.build_sync_payload(body.edge_id),
        },
    }


@app.get("/api/v1/edges/{edge_id}/twin")
async def api_edge_twin_detail(edge_id: str, current_user: UserClaims = Depends(_decode_user)):
    registry = _edge_registry_map()
    row = registry.get(edge_id)
    if row is None:
        raise HTTPException(status_code=404, detail="edge_not_found")
    if row.get("tenant_id") != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    twin_mgr = get_edge_twin_manager()
    desired = twin_mgr.get_desired_state(edge_id)
    actual = twin_mgr.get_actual_state(edge_id)
    diff = twin_mgr.compute_diff(edge_id)
    return {
        "ok": True,
        "edge_id": edge_id,
        "desired": desired.to_dict() if desired else None,
        "actual": actual.to_dict() if actual else None,
        "diff": diff.to_dict(),
        "is_synced": not diff.has_diff,
    }


@app.patch("/api/v1/edges/{edge_id}/twin/desired")
async def api_edge_twin_desired_update(
    edge_id: str,
    body: EdgeTwinDesiredUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    registry = _edge_registry_map()
    row = registry.get(edge_id)
    if row is None:
        raise HTTPException(status_code=404, detail="edge_not_found")
    if row.get("tenant_id") != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    desired = get_edge_twin_manager().update_desired_state(
        edge_id=edge_id,
        tenant_id=str(row.get("tenant_id") or current_user.tenant_id),
        updates=body.updates,
    )
    diff = get_edge_twin_manager().compute_diff(edge_id)
    return {
        "ok": True,
        "resource_version": desired.resource_version,
        "desired": desired.to_dict(),
        "diff": diff.to_dict(),
        "sync_payload": get_edge_twin_manager().build_sync_payload(edge_id),
    }


@app.get("/api/v1/edges/twin-overview")
async def api_edge_twin_overview(current_user: UserClaims = Depends(_decode_user)):
    items = get_edge_twin_manager().list_overview(current_user.tenant_id)
    return {
        "ok": True,
        "items": items,
        "total_unsynced": sum(1 for item in items if not item.get("is_synced")),
    }


@app.get("/edge/consent/{edge_id}")
async def edge_consent_get(
    edge_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    consent = edge_resource_get_consent(edge_id)
    if consent is None:
        raise HTTPException(status_code=404, detail="edge consent not found")
    if consent.get("tenant_id") != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    if consent.get("user_id") != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user")
    return {"ok": True, "consent": consent}


@app.put("/edge/consent/{edge_id}")
async def edge_consent_upsert(
    edge_id: str,
    body: EdgeConsentUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if body.user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user")
    consent = edge_resource_upsert_consent(
        edge_id=edge_id,
        user_id=body.user_id,
        tenant_id=current_user.tenant_id,
        consent_version=body.consent_version,
        accepted=body.consent_accepted,
        ip_share_enabled=body.ip_share_enabled,
        compute_share_enabled=body.compute_share_enabled,
        otp_relay_enabled=body.otp_relay_enabled,
        operator=current_user.sub,
        notes=body.notes,
    )
    _remember_event(
        user_id=body.user_id,
        trace_id=None,
        node="edge.consent",
        event_type="updated",
        payload={
            "edge_id": edge_id,
            "status": consent.get("status"),
            "ip_share_enabled": bool(consent.get("ip_share_enabled")),
            "compute_share_enabled": bool(consent.get("compute_share_enabled")),
            "consent_version": consent.get("consent_version"),
        },
        level="warning",
    )
    return {"ok": True, "consent": consent}


@app.post("/edge/consent/{edge_id}/revoke")
async def edge_consent_revoke(
    edge_id: str,
    body: EdgeConsentRevokeRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    consent = edge_resource_get_consent(edge_id)
    if consent is None:
        raise HTTPException(status_code=404, detail="edge consent not found")
    if consent.get("tenant_id") != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    if consent.get("user_id") != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user")
    result = edge_resource_revoke_consent(edge_id=edge_id, operator=current_user.sub, reason=body.reason)
    _remember_event(
        user_id=str(consent.get("user_id") or current_user.sub),
        trace_id=None,
        node="edge.consent",
        event_type="revoked",
        payload={"edge_id": edge_id, "reason": body.reason},
        level="warning",
    )
    return result


@app.post("/edge/lease/start", dependencies=[Depends(_verify_edge_secret)])
async def edge_lease_start(body: EdgeLeaseStartRequest):
    user_id, tenant_id, _ = _resolve_edge_owner(body.edge_id, None)
    result = edge_resource_start_lease(
        edge_id=body.edge_id,
        user_id=user_id,
        tenant_id=tenant_id,
        resource_type=body.resource_type,
        purpose_code=body.purpose_code,
        requester=body.requester,
        approved_by=body.approved_by,
        trace_id=body.trace_id,
        task_id=body.task_id,
        metadata=body.metadata,
    )
    _remember_event(
        user_id=user_id,
        trace_id=body.trace_id,
        node="edge.lease",
        event_type="started" if result.get("ok") else "denied",
        payload={
            "edge_id": body.edge_id,
            "resource_type": body.resource_type,
            "purpose_code": body.purpose_code,
            "reason": result.get("reason"),
            "lease_id": ((result.get("lease") or {}).get("lease_id")),
        },
        level="warning" if not result.get("ok") else "info",
    )
    if not result.get("ok"):
        return JSONResponse(status_code=403, content=result)
    return result


@app.post("/edge/lease/end", dependencies=[Depends(_verify_edge_secret)])
async def edge_lease_end(body: EdgeLeaseEndRequest):
    result = edge_resource_end_lease(
        lease_id=body.lease_id,
        status=body.status,
        reason=body.reason,
        operator=body.operator,
    )
    if not result.get("ok"):
        return JSONResponse(status_code=400, content=result)
    lease = result.get("lease") or {}
    _remember_event(
        user_id=str(lease.get("user_id") or "user"),
        trace_id=str(lease.get("trace_id") or "").strip() or None,
        node="edge.lease",
        event_type="ended",
        payload={
            "lease_id": body.lease_id,
            "edge_id": lease.get("edge_id"),
            "resource_type": lease.get("resource_type"),
            "duration_sec": lease.get("duration_sec"),
            "status": lease.get("status"),
        },
        level="info",
    )
    return result


@app.get("/edge/lease/logs")
async def edge_lease_logs(
    user_id: str | None = Query(default=None),
    edge_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = str(user_id or current_user.sub).strip()
    if effective_user != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user")
    rows = edge_resource_list_leases(
        tenant_id=current_user.tenant_id,
        user_id=effective_user,
        edge_id=edge_id,
        limit=limit,
    )
    return {"ok": True, "count": len(rows), "items": rows}


@app.get("/edge/resource/summary")
async def edge_resource_dashboard(
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = str(user_id or current_user.sub).strip()
    if effective_user != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user")
    data = edge_resource_summary(tenant_id=current_user.tenant_id, user_id=effective_user)
    return {"ok": True, "summary": data}


def _reward_tier(points: int) -> str:
    if points >= 6000:
        return "diamond"
    if points >= 3000:
        return "gold"
    if points >= 1200:
        return "silver"
    if points >= 300:
        return "bronze"
    return "seed"


@app.get("/rewards/wallet")
async def rewards_wallet(
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = str(user_id or current_user.sub).strip()
    if effective_user != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    wallet = edge_reward_wallet_snapshot(user_id=effective_user, tenant_id=current_user.tenant_id)
    points = int(wallet.get("points_balance", 0) or 0)
    online_seconds_total = int(wallet.get("online_seconds_total", 0) or 0)
    payload = {
        "points": points,
        "tier": _reward_tier(points),
        "free_runs_credit": int(wallet.get("free_run_credit", 0) or 0),
        "free_tokens_credit": int(wallet.get("free_token_credit", 0) or 0),
        "online_seconds_total": online_seconds_total,
        "recent_edge_seconds": max(0, online_seconds_total % 86400),
        "last_claim_at": wallet.get("last_claim_at"),
    }
    return {"ok": True, "wallet": payload, "raw": wallet}


@app.get("/rewards/claims")
async def rewards_claims(
    user_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user = str(user_id or current_user.sub).strip()
    if effective_user != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    rows = edge_reward_list_claims(user_id=effective_user, tenant_id=current_user.tenant_id, limit=limit)
    return {"ok": True, "count": len(rows), "items": rows}


@app.post("/rewards/claim/free-pack")
async def rewards_claim_free_pack(
    body: EdgeRewardClaimRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    result = edge_reward_claim_free_pack(
        user_id=current_user.sub,
        tenant_id=current_user.tenant_id,
        claim_type=body.claim_type,
        note=body.note,
    )
    status_code = 200 if result.get("ok") else 400
    return JSONResponse(
        status_code=status_code,
        content={
            "ok": bool(result.get("ok")),
            "result": result,
        },
    )


@app.post("/otp/request", dependencies=[Depends(_verify_edge_secret)])
async def otp_request(body: OtpRequestCreateRequest):
    user_id, tenant_id, _ = _resolve_edge_owner(body.edge_id, body.user_id)
    created = otp_create_request(
        tenant_id=tenant_id,
        user_id=user_id,
        edge_id=body.edge_id,
        account_id=body.account_id,
        platform=body.platform,
        purpose=body.purpose,
        masked_target=body.masked_target,
        message=body.message,
        trace_id=body.trace_id,
        ttl_sec=body.ttl_sec,
        max_attempts=body.max_attempts,
    )
    hint = body.masked_target or body.account_id or body.platform
    if body.feishu_chat_id:
        await send_chat_reply(
            body.feishu_chat_id,
            f"📩 收到验证码请求\n请求ID: {created['request_id']}\n平台: {body.platform}\n目标: {hint}\n请在客户端提交验证码。",
            channel="feishu",
        )
    _remember_event(
        user_id=user_id,
        trace_id=body.trace_id,
        node="otp.request",
        event_type="created",
        payload={"request_id": created["request_id"], "edge_id": body.edge_id, "platform": body.platform},
        level="warning",
    )
    return {"ok": True, "request": created}


@app.get("/otp/pending")
async def otp_pending(
    include_consumed: bool = Query(default=False),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    status_filter = None if include_consumed else "pending"
    items = otp_list_requests(
        user_id=current_user.sub,
        tenant_id=current_user.tenant_id,
        status_filter=status_filter,
        limit=limit,
    )
    return {"ok": True, "count": len(items), "items": items}


@app.post("/otp/submit")
async def otp_submit(
    body: OtpSubmitRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    submit = otp_submit_code(
        request_id=body.request_id,
        user_id=current_user.sub,
        tenant_id=current_user.tenant_id,
        code=body.code,
        operator=body.operator or current_user.sub,
        allow_admin_cross_user="admin" in current_user.roles,
    )
    if not submit.get("ok"):
        return JSONResponse(status_code=400, content=submit)

    request_row = submit.get("request") or {}
    edge_id = str(request_row.get("edge_id") or "").strip()
    if edge_id:
        package = {
            "type": "otp_code",
            "request_id": body.request_id,
            "code": submit.get("otp_plain"),
            "platform": request_row.get("platform"),
            "account_id": request_row.get("account_id"),
            "trace_id": request_row.get("trace_id"),
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        outbox_manager = _edge_outbox_manager()
        if outbox_manager is not None:
            await outbox_manager.enqueue(
                tenant_id=str(request_row.get("tenant_id") or current_user.tenant_id or "tenant_main"),
                node_id=edge_id,
                msg_type="otp_code",
                payload=package,
                delivery_mode="poll",
            )
        else:
            _edge_outbox_map().setdefault(edge_id, []).append(package)

    _remember_event(
        user_id=current_user.sub,
        trace_id=str(request_row.get("trace_id") or "").strip() or None,
        node="otp.submit",
        event_type="submitted",
        payload={"request_id": body.request_id, "edge_id": edge_id, "platform": request_row.get("platform")},
        level="warning",
    )
    submit.pop("otp_plain", None)
    return {"ok": True, **submit}


@app.post("/otp/cancel")
async def otp_cancel(
    body: OtpCancelRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    result = otp_cancel_request(
        request_id=body.request_id,
        user_id=current_user.sub,
        tenant_id=current_user.tenant_id,
        operator=current_user.sub,
        allow_admin_cross_user="admin" in current_user.roles,
    )
    if not result.get("ok"):
        return JSONResponse(status_code=400, content=result)
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="otp.cancel",
        event_type="canceled",
        payload={"request_id": body.request_id, "reason": body.reason},
        level="warning",
    )
    return {"ok": True, **result}


@app.post("/otp/consume", dependencies=[Depends(_verify_edge_secret)])
async def otp_consume(body: OtpConsumeRequest):
    result = otp_mark_consumed(
        request_id=body.request_id,
        edge_id=body.edge_id,
        status=body.status,
        reason=body.reason,
    )
    status_code = 200 if result.get("ok") else 400
    return JSONResponse(status_code=status_code, content=result)


async def _run_dm_pipeline(edge_id: str, account_id: str, dm_text: str, user_id_hint: str | None = None) -> dict[str, Any]:
    edge_info = app.state.edge_registry.get(edge_id, {})
    user_id = str(user_id_hint or edge_info.get("user_id") or account_id)
    tenant_id = str(edge_info.get("tenant_id") or "tenant_main")
    trace_id = f"dm_{edge_id}_{int(time.time())}"
    thread_id = f"{user_id}_{edge_id}"
    config = _graph_config(
        thread_id,
        run_type="dm_pipeline",
        user_id=user_id,
        extra={"edge_id": edge_id, "account_id": account_id, "tenant_id": tenant_id, "trace_id": trace_id},
    )
    state_input = {
        "edge_id": edge_id,
        "account_id": account_id,
        "dm_text": dm_text,
        "user_id": user_id,
        "tenant_id": tenant_id,
        "trace_id": trace_id,
        "call_log": [],
    }
    result = await app.state.dm_graph.ainvoke(state_input, config)
    return {
        "ok": True,
        "trace_id": trace_id,
        "thread_id": thread_id,
        "edge_id": edge_id,
        "account_id": account_id,
        "catcher_output": result.get("catcher_output", {}),
        "abacus_output": result.get("abacus_output", {}),
        "followup_output": result.get("followup_output", {}),
        "followup_spawn": result.get("followup_spawn", {}),
        "clawteam_queue": result.get("clawteam_queue", {}),
        "score": result.get("score", 0),
        "call_log": result.get("call_log", []),
    }


@app.get("/delivery/readiness")
async def delivery_readiness(
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if user_id and current_user.sub != user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    effective_user_id = user_id or current_user.sub
    return {
        "ok": True,
        "user_id": effective_user_id,
        "readiness": _delivery_readiness_snapshot(effective_user_id),
    }


@app.get("/commercial/readiness")
async def commercial_readiness(current_user: UserClaims = Depends(_decode_user)):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    return {
        "ok": True,
        "tenant_id": current_user.tenant_id,
        "readiness": _commercial_readiness_snapshot(),
    }


@app.post("/campaigngraph/simulate")
async def campaigngraph_simulate(
    body: CampaignSimulationRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if current_user.sub != body.user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")

    targets: list[dict[str, Any]] = []
    for target in body.edge_targets:
        row = target.model_dump()
        row["skills"] = _normalize_skills(row.get("skills"))
        row["skill_commands"] = _normalize_commands(row.get("skill_commands"))
        targets.append(row)
    if not targets:
        for row in _edge_registry_map().values():
            if row.get("user_id") == body.user_id:
                targets.append(
                    {
                        "edge_id": row.get("edge_id"),
                        "account_id": row.get("account_id"),
                        "webhook_url": row.get("webhook_url"),
                        "instruction_hint": "campaigngraph-preview",
                        "skills": _normalize_skills(row.get("skills")),
                        "skill_manifest_path": row.get("skill_manifest_path"),
                        "skill_commands": _normalize_commands(row.get("skill_commands")),
                        "skill_manifest_meta": row.get("skill_manifest_meta") or {},
                    }
                )

    simulation = simulate_campaign_graph(
        CampaignGraphInput(
            user_id=body.user_id,
            task_description=body.task_description,
            competitor_handles=body.competitor_handles,
            edge_targets=targets,
        )
    )
    simulation["edge_targets"] = targets
    simulation["status"] = "simulated"
    simulation["approval"] = {
        "decision": "pending",
        "operator": None,
        "reason": None,
        "updated_at": None,
    }
    app.state.campaign_simulations[str(simulation["simulation_id"])] = simulation
    _remember_event(
        user_id=body.user_id,
        trace_id=str(simulation.get("simulation_id") or ""),
        node="campaigngraph",
        event_type="simulation_created",
        payload={
            "edge_target_count": len(targets),
            "recommendation": simulation.get("recommendation"),
            "cost_estimate": simulation.get("cost_estimate"),
            "selected_routes": simulation.get("selected_routes"),
            "planner_state": simulation.get("planner_state"),
        },
        level="info",
    )
    return {"ok": True, "simulation": simulation}


@app.get("/campaigngraph/simulations")
async def campaigngraph_simulations(
    user_id: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")

    all_items = list(getattr(app.state, "campaign_simulations", {}).values())
    filtered = [item for item in all_items if str(item.get("user_id") or "") == effective_user_id]
    filtered.sort(key=lambda x: str(x.get("created_at") or ""), reverse=True)
    return {"ok": True, "count": min(len(filtered), limit), "items": filtered[:limit]}


@app.post("/campaigngraph/approve-dispatch")
async def campaigngraph_approve_dispatch(
    body: CampaignSimulationApproveRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    record = dict(getattr(app.state, "campaign_simulations", {}).get(body.simulation_id) or {})
    if not record:
        raise HTTPException(status_code=404, detail="simulation_id not found")

    user_id = str(record.get("user_id") or "")
    if user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")

    decision = str(body.decision or "approve").strip().lower()
    if decision not in {"approve", "reject"}:
        raise HTTPException(status_code=400, detail="decision must be approve/reject")

    approval = {
        "decision": decision,
        "operator": current_user.sub,
        "reason": (body.reason or "").strip()[:500] or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    record["approval"] = approval
    record["status"] = "approved" if decision == "approve" else "rejected"
    app.state.campaign_simulations[body.simulation_id] = record

    _remember_event(
        user_id=user_id,
        trace_id=body.simulation_id,
        node="campaigngraph",
        event_type="simulation_decision",
        payload=approval,
        level="info",
    )

    if decision != "approve":
        return {"ok": True, "status": "rejected", "simulation": record}

    request_id = str(uuid.uuid4())
    edge_targets = list(record.get("edge_targets") or [])
    edge_scope = str((edge_targets[0] or {}).get("edge_id") or "central") if edge_targets else "central"
    thread_id = f"{user_id}_{edge_scope}"
    payload = {
        "trace_id": request_id,
        "task_description": str(record.get("task_description") or ""),
        "user_id": user_id,
        "competitor_handles": list(record.get("competitor_handles") or []),
        "target_account_url": "",
        "analysis_mode": False,
        "edge_targets": edge_targets,
        "messages": [],
        "delivery_results": [],
    }
    config = _graph_config(
        thread_id,
        run_type="campaigngraph_approve_dispatch",
        user_id=user_id,
        extra={"simulation_id": body.simulation_id, "request_id": request_id},
    )
    result = await _invoke_dynamic_graph(
        goal=str(record.get("task_description") or "发布 分发 内容"),
        payload=payload,
        config=config,
    )
    _remember_event(
        user_id=user_id,
        trace_id=request_id,
        node="campaigngraph.approve.dispatch",
        event_type="dispatch_completed",
        payload={
            "simulation_id": body.simulation_id,
            "delivery_result_count": len(result.get("delivery_results", []) or []),
            "score": result.get("score", 0),
        },
        level="info",
    )

    # ── CapacityWake：通知边缘节点有新分发任务 ────────────────────────
    try:
        from bridge_protocol import get_bridge_manager
        _bridge = get_bridge_manager()
        _tenant_id = str(record.get("tenant_id") or user_id or "tenant_main")
        _woken_edge = await _bridge.capacity_wake.wake_any(
            tenant_id=_tenant_id,
            task_id=request_id,
            required_capability="content_publish",
            priority=1,
            payload={
                "simulation_id": body.simulation_id,
                "dispatch_plan": result.get("dispatch_plan", {}),
            },
        )
    except Exception:
        _woken_edge = None

    return {
        "ok": True,
        "status": "approved_and_dispatched",
        "simulation_id": body.simulation_id,
        "request_id": request_id,
        "thread_id": thread_id,
        "score": result.get("score", 0),
        "delivery_results": result.get("delivery_results", []),
        "content_package": result.get("content_package", {}),
        "call_log": result.get("call_log", []),
        "woken_edge": _woken_edge,
    }


async def _run_formula_ingest_from_chat(
    chat_id: str,
    url: str,
    channel: str = "telegram",
    reply_context: dict[str, Any] | None = None,
    session_id: str | None = None,
) -> None:
    trace_id = f"chat_formula_{uuid.uuid4()}"
    payload = {
        "trace_id": trace_id,
        "task_description": f"Analyze competitor formula for {url}",
        "user_id": chat_id,
        "competitor_handles": [url],
        "target_account_url": url,
        "analysis_mode": True,
        "edge_targets": [],
        "messages": _chat_session_history_messages(session_id),
        "delivery_results": [],
    }
    config = _graph_config(
        chat_id,
        run_type="chat_formula_ingest",
        user_id=chat_id,
        extra={"source_url": url, "trace_id": trace_id},
    )
    try:
        result = await _invoke_dynamic_graph(
            goal=f"Analyze competitor formula for {url}",
            payload=payload,
            config=config,
        )
        ingested = int(result.get("rag_ingested_count", 0) or 0)
        multimodal_assets = len(result.get("competitor_multimodal_assets", []) or [])
        rag_mode = str(result.get("rag_mode") or "fallback")
        await send_chat_reply(
            chat_id,
            (
                "🧠 报告老大：公式拆解完毕！已收录至 Qdrant 兵法库。"
                f"({formula_count}条解析 / {multimodal_assets}个多模态资产 / {ingested}条入库 / mode={rag_mode})"
            ),
            channel=channel,
            reply_context=reply_context,
            session_id=session_id,
        )
    except Exception as exc:  # noqa: BLE001
        await send_chat_reply(
            chat_id,
            f"⚠️ [元老院] 公式拆解失败：{exc}",
            channel=channel,
            reply_context=reply_context,
            session_id=session_id,
        )


async def _run_inkwriter_from_chat(
    chat_id: str,
    task_text: str,
    channel: str = "telegram",
    reply_context: dict[str, Any] | None = None,
    session_id: str | None = None,
) -> None:
    trace_id = f"chat_ink_{uuid.uuid4()}"
    payload = {
        "trace_id": trace_id,
        "task_description": task_text,
        "user_id": chat_id,
        "competitor_handles": [],
        "target_account_url": "",
        "analysis_mode": False,
        "edge_targets": [],
        "messages": _chat_session_history_messages(session_id),
        "delivery_results": [],
    }
    config = _graph_config(
        chat_id,
        run_type="chat_inkwriter",
        user_id=chat_id,
        extra={"trace_id": trace_id},
    )
    try:
        result = await _invoke_dynamic_graph(
            goal=task_text,
            payload=payload,
            config=config,
        )
        strategy_text = (
            json.dumps(strategy, ensure_ascii=False, indent=2)[:1200]
            if isinstance(strategy, dict)
            else str(strategy)
        )
        await send_chat_reply(
            chat_id,
            "✅ 吐墨虾交稿：\n"
            "```json\n"
            f"{strategy_text}\n"
            "```",
            channel=channel,
            reply_context=reply_context,
            session_id=session_id,
        )
    except Exception as exc:  # noqa: BLE001
        await send_chat_reply(
            chat_id,
            f"⚠️ [吐墨虾] 指令执行失败：{exc}",
            channel=channel,
            reply_context=reply_context,
            session_id=session_id,
        )


async def _ensure_template_ready_for_industry(industry: str) -> dict[str, Any]:
    normalized = str(industry or "general").strip().lower() or "general"
    active = registry_resolve_active_template(normalized)
    if bool(active.get("has_workflow")):
        return {
            "ok": True,
            "industry": normalized,
            "status": "active_exists",
            "workflow_path": active.get("workflow_path"),
            "source": active.get("source"),
        }

    existing = registry_list_templates_by_industry(normalized)
    if existing:
        first_name = str(existing[0].get("name", "")).strip()
        if first_name:
            activated = registry_activate_template(industry=normalized, name=first_name)
            if bool(activated.get("ok")):
                return {
                    "ok": True,
                    "industry": normalized,
                    "status": "activated_existing",
                    "activated": activated,
                }

    recommend = await workflow_recommend_official_templates(industry=normalized, limit=12)
    if not bool(recommend.get("ok")):
        return {"ok": False, "industry": normalized, "error": recommend.get("error", "recommend_failed")}

    candidates = recommend.get("templates", [])
    if not isinstance(candidates, list):
        candidates = []
    selected = next((row for row in candidates if isinstance(row, dict) and str(row.get("raw_url", "")).strip()), None)
    if not isinstance(selected, dict):
        return {"ok": False, "industry": normalized, "error": "no_recommend_template_found"}

    template_name = str(selected.get("name") or selected.get("id") or f"{normalized}-auto").strip()
    if not template_name:
        template_name = f"{normalized}-auto"
    imported = await registry_import_template_from_github_raw(
        industry=normalized,
        name=template_name,
        raw_url=str(selected.get("raw_url", "")).strip(),
        source_repo="Comfy-Org/workflow_templates",
        ref="main",
    )
    if not bool(imported.get("ok")):
        return {"ok": False, "industry": normalized, "error": imported.get("error", "template_import_failed")}

    activated = registry_activate_template(industry=normalized, name=template_name)
    if not bool(activated.get("ok")):
        return {"ok": False, "industry": normalized, "error": activated.get("error", "template_activate_failed")}
    return {
        "ok": True,
        "industry": normalized,
        "status": "imported_and_activated",
        "selected_template": template_name,
        "imported": imported,
        "activated": activated,
    }


async def _run_video_generation_from_chat(
    chat_id: str,
    command_text: str,
    industry: str,
    channel: str = "telegram",
    reply_context: dict[str, Any] | None = None,
    session_id: str | None = None,
) -> None:
    intent = _extract_video_generation_intent(command_text) or {}
    normalized_industry = str(industry or intent.get("industry") or "general").strip().lower() or "general"

    template_ready = await _ensure_template_ready_for_industry(normalized_industry)
    if not bool(template_ready.get("ok")):
        await send_chat_reply(
            chat_id,
            f"⚠️ 模板准备失败：{template_ready.get('error', 'unknown_error')}（industry={normalized_industry}）",
            channel=channel,
            reply_context=reply_context,
            session_id=session_id,
        )
        return

    trace_id = f"chat_video_{uuid.uuid4()}"
    style_hint_parts = []
    if bool(intent.get("digital_human_mode")):
        style_hint_parts.append("优先数字人口播风格，注重口型同步与人设一致性")
    if bool(intent.get("vlog_narration_mode")):
        style_hint_parts.append("优先旁白式 Vlog 叙事，加入生活化转场和节奏峰值")
    style_hint = "；".join(style_hint_parts)

    payload = {
        "trace_id": trace_id,
        "task_description": f"{command_text}\n行业标签: {normalized_industry}\n{style_hint}".strip(),
        "user_id": chat_id,
        "competitor_handles": [],
        "target_account_url": "",
        "analysis_mode": False,
        "edge_targets": [],
        "messages": _chat_session_history_messages(session_id),
        "delivery_results": [],
    }
    config = _graph_config(
        chat_id,
        run_type="chat_video_generation",
        user_id=chat_id,
        extra={"trace_id": trace_id, "industry": normalized_industry},
    )
    try:
        result = await _invoke_dynamic_graph(
            goal=f"{command_text} 视觉 视频 分镜",
            payload=payload,
            config=config,
            industry_context={"industry_tag": normalized_industry},
        )
        media_pack = visualizer_output.get("media_pack", []) if isinstance(visualizer_output, dict) else []
        template_selection = (
            visualizer_output.get("template_selection", {}) if isinstance(visualizer_output, dict) else {}
        )
        urls = [
            str(row.get("url", "")).strip()
            for row in (media_pack if isinstance(media_pack, list) else [])
            if isinstance(row, dict) and str(row.get("url", "")).strip()
        ]
        top_urls = urls[:3]
        preview_lines = "\n".join(f"- {url}" for url in top_urls) if top_urls else "- (暂无可预览链接)"
        await send_chat_reply(
            chat_id,
            "🎬 酒店推广视频已生成并进入任务链路：\n"
            f"- industry: `{normalized_industry}`\n"
            f"- template: `{template_selection.get('selected') or template_ready.get('selected_template', '-')}`\n"
            f"- engine: `{visualizer_output.get('engine', '-')}`\n"
            f"- media_count: `{len(urls)}`\n"
            "预览链接：\n"
            f"{preview_lines}",
            channel=channel,
            reply_context=reply_context,
            session_id=session_id,
        )
    except Exception as exc:  # noqa: BLE001
        await send_chat_reply(
            chat_id,
            f"⚠️ 视频生成指令执行失败：{exc}",
            channel=channel,
            reply_context=reply_context,
            session_id=session_id,
        )


async def _run_campaign_simulation_from_chat(
    chat_id: str,
    task_text: str,
    channel: str = "telegram",
    reply_context: dict[str, Any] | None = None,
) -> None:
    try:
        user_targets: list[dict[str, Any]] = []
        for row in _edge_registry_map().values():
            if str(row.get("user_id") or "") == chat_id:
                user_targets.append(
                    {
                        "edge_id": row.get("edge_id"),
                        "account_id": row.get("account_id"),
                        "webhook_url": row.get("webhook_url"),
                        "instruction_hint": "chat_campaign_simulation",
                        "skills": _normalize_skills(row.get("skills")),
                        "skill_manifest_path": row.get("skill_manifest_path"),
                        "skill_commands": _normalize_commands(row.get("skill_commands")),
                        "skill_manifest_meta": row.get("skill_manifest_meta") or {},
                    }
                )
        simulation = simulate_campaign_graph(
            CampaignGraphInput(
                user_id=chat_id,
                task_description=task_text,
                competitor_handles=[],
                edge_targets=user_targets,
            )
        )
        simulation["edge_targets"] = user_targets
        simulation["status"] = "simulated"
        simulation["approval"] = {"decision": "pending", "operator": None, "reason": None, "updated_at": None}
        app.state.campaign_simulations[str(simulation["simulation_id"])] = simulation
        await send_chat_reply(
            chat_id,
            summarize_simulation_for_chat(simulation)
            + f"\n- simulation_id: `{simulation.get('simulation_id')}`\n"
            + "可在控制台调用 /campaigngraph/approve-dispatch 完成审批下发。",
            channel=channel,
            reply_context=reply_context,
        )
    except Exception as exc:  # noqa: BLE001
        await send_chat_reply(chat_id, f"⚠️ [CampaignGraph] 仿真失败：{exc}", channel=channel, reply_context=reply_context)


@app.post("/webhook/chat_gateway")
async def chat_gateway(request: Request, background_tasks: BackgroundTasks):
    """
    Lightweight mobile chatbot gateway.
    - Return fast 200 OK to avoid webhook retries.
    - Route intent by URL / mention / report keywords.
    """
    body_bytes = await request.body()
    body_text = body_bytes.decode("utf-8", errors="replace") if body_bytes else ""
    try:
        payload = json.loads(body_text) if body_text else {}
        if not isinstance(payload, dict):
            payload = {}
    except Exception:  # noqa: BLE001
        payload = {}

    # Feishu URL verification handshake
    if payload.get("type") == "url_verification" and payload.get("challenge"):
        return {"challenge": payload.get("challenge")}
    if (
        isinstance(payload.get("header"), dict)
        and payload["header"].get("event_type") == "url_verification"
        and payload.get("challenge")
    ):
        return {"challenge": payload.get("challenge")}
    # DingTalk callback challenge
    if payload.get("challenge") and (
        payload.get("encrypt")
        or payload.get("schema")
        or payload.get("conversationId")
    ):
        return {"challenge": payload.get("challenge")}

    channel, chat_id, user_text, reply_context = _extract_chat_envelope(payload)
    peer_id = _extract_peer_id(payload, fallback=chat_id)
    session_mode = _resolve_chat_session_mode(channel)
    session_lobster = "echoer"
    session = session_mgr.get_or_create(
        peer_id=peer_id or chat_id,
        lobster_id=session_lobster,
        mode=session_mode,
        channel=channel,
        tenant_id="default",
    )
    safe_headers = {str(k): str(v) for k, v in request.headers.items()}
    safe_query_params = {str(k): str(v) for k, v in request.query_params.items()}
    security_ok, security_reason = await _verify_chat_webhook_security(
        channel=channel,
        payload=payload,
        headers=safe_headers,
        query_params=safe_query_params,
        body_text=body_text,
    )
    if not security_ok:
        return JSONResponse(
            status_code=401,
            content={
                "ok": False,
                "error": "webhook_security_check_failed",
                "reason": security_reason,
                "channel": channel,
            },
        )

    route_map: dict[str, dict[str, Any]] = getattr(app.state, "chat_route_map", {})
    route_map[chat_id] = {
        "channel": channel,
        "reply_context": reply_context,
        "peer_id": peer_id,
        "session_id": session.session_id,
        "session_mode": session.mode,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    app.state.chat_route_map = route_map

    if not user_text:
        _queue_chat_reply(
            background_tasks,
            chat_id,
            "收到消息，但未识别到文本内容。请直接输入指令或链接。",
            channel=channel,
            reply_context=reply_context,
            session_id=session.session_id,
        )
        return {"ok": True, "routed": "empty_text", "chat_id": chat_id, "channel": channel}

    url = _extract_first_url(user_text)
    if url:
        session_lobster = "radar"
        session = session_mgr.get_or_create(
            peer_id=peer_id or chat_id,
            lobster_id=session_lobster,
            mode=session_mode,
            channel=channel,
            tenant_id="default",
        )
        session_mgr.append_message(session.session_id, role="user", content=user_text)
        _queue_chat_reply(
            background_tasks,
            chat_id,
            "👀 [触须虾] 收到链接，正在潜入目标...",
            channel=channel,
            reply_context=reply_context,
            session_id=session.session_id,
        )
        background_tasks.add_task(_run_formula_ingest_from_chat, chat_id, url, channel, reply_context, session.session_id)
        return {"ok": True, "routed": "feed_evolution", "chat_id": chat_id, "channel": channel}

    if INKWRITER_MENTION_RE.search(user_text):
        session_lobster = "inkwriter"
        session = session_mgr.get_or_create(
            peer_id=peer_id or chat_id,
            lobster_id=session_lobster,
            mode=session_mode,
            channel=channel,
            tenant_id="default",
        )
        session_mgr.append_message(session.session_id, role="user", content=user_text)
        task_text = _extract_inkwriter_task(user_text) or "按当前大盘生成一版高转化文案策略"
        _queue_chat_reply(
            background_tasks,
            chat_id,
            "✍️ 收到指令，结合 RAG 兵法疯狂码字中...",
            channel=channel,
            reply_context=reply_context,
            session_id=session.session_id,
        )
        background_tasks.add_task(_run_inkwriter_from_chat, chat_id, task_text, channel, reply_context, session.session_id)
        return {"ok": True, "routed": "inkwriter_command", "chat_id": chat_id, "channel": channel}

    video_intent = _extract_video_generation_intent(user_text)
    if video_intent:
        session_lobster = "visualizer"
        session = session_mgr.get_or_create(
            peer_id=peer_id or chat_id,
            lobster_id=session_lobster,
            mode=session_mode,
            channel=channel,
            tenant_id="default",
        )
        session_mgr.append_message(session.session_id, role="user", content=user_text)
        _queue_chat_reply(
            background_tasks,
            chat_id,
            (
                "🎬 已收到视频工厂指令，正在激活行业模板并下发生成任务...\n"
                f"- industry: `{video_intent.get('industry', 'general')}`\n"
                f"- 数字人口播: `{bool(video_intent.get('digital_human_mode'))}`\n"
                f"- 旁白vlog: `{bool(video_intent.get('vlog_narration_mode'))}`"
            ),
            channel=channel,
            reply_context=reply_context,
            session_id=session.session_id,
        )
        background_tasks.add_task(
            _run_video_generation_from_chat,
            chat_id,
            user_text,
            str(video_intent.get("industry", "general")),
            channel,
            reply_context,
            session.session_id,
        )
        return {"ok": True, "routed": "video_generation", "chat_id": chat_id, "channel": channel}

    if REPORT_RE.search(user_text):
        session = session_mgr.get_or_create(
            peer_id=peer_id or chat_id,
            lobster_id="abacus",
            mode=session_mode,
            channel=channel,
            tenant_id="default",
        )
        session_mgr.append_message(session.session_id, role="user", content=user_text)
        _queue_chat_reply(
            background_tasks,
            chat_id,
            _render_static_report(),
            channel=channel,
            reply_context=reply_context,
            session_id=session.session_id,
        )
        return {"ok": True, "routed": "battle_report", "chat_id": chat_id, "channel": channel}

    session = session_mgr.get_or_create(
        peer_id=peer_id or chat_id,
        lobster_id="echoer",
        mode=session_mode,
        channel=channel,
        tenant_id="default",
    )
    session_mgr.append_message(session.session_id, role="user", content=user_text)
    _queue_chat_reply(
        background_tasks,
        chat_id,
        "可识别指令：\n"
        "1) 发链接：自动对标拆解并收录RAG\n"
        "2) @吐墨虾 + 任务：触发内容生成\n"
        "3) 发送“生成酒店推广视频”：自动激活行业模板并生成视频\n"
        "4) 发送“战报”或“大盘”：返回运营战报",
        channel=channel,
        reply_context=reply_context,
        session_id=session.session_id,
    )
    return {"ok": True, "routed": "fallback_help", "chat_id": chat_id, "channel": channel}


@app.post("/run-dragon-team", response_model=TaskResponse)
async def run_dragon_team(request: TaskRequest, current_user: UserClaims = Depends(_decode_user)):
    if current_user.sub != request.user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="user_id mismatch with login user")

    request_id = str(uuid.uuid4())
    request_industry_hint = str(request.industry or request.industry_tag or "").strip() or None
    workflow_context = request.industry_workflow_context if isinstance(request.industry_workflow_context, dict) else {}
    workflow_request = workflow_context.get("request", {}) if isinstance(workflow_context.get("request"), dict) else {}
    workflow_blueprint = workflow_context.get("blueprint", {}) if isinstance(workflow_context.get("blueprint"), dict) else {}
    workflow_merchant = workflow_request.get("merchantProfile", {}) if isinstance(workflow_request.get("merchantProfile"), dict) else {}
    workflow_bind_accounts = [
        str(item).strip()
        for item in workflow_merchant.get("bindAccounts", [])
        if str(item).strip()
    ] if isinstance(workflow_merchant.get("bindAccounts"), list) else []
    effective_competitor_handles = request.competitor_handles or workflow_bind_accounts
    workflow_category = str(workflow_request.get("categoryId") or "").strip()
    workflow_sub_industry = str(workflow_request.get("subIndustryId") or "").strip()
    workflow_industry_tag_hint = (
        f"{workflow_category}.{workflow_sub_industry}"
        if workflow_category and workflow_sub_industry
        else None
    )
    industry_workflow_digest = {
        "workflow_id": str(workflow_request.get("workflowId") or workflow_blueprint.get("workflowId") or "").strip() or None,
        "industry_tag_hint": workflow_industry_tag_hint,
        "brand_name": str(workflow_merchant.get("brandName") or "").strip() or None,
        "approval_steps": len(workflow_blueprint.get("approvalSummary", []) or []) if isinstance(workflow_blueprint.get("approvalSummary"), list) else 0,
        "channels": workflow_request.get("channels") if isinstance(workflow_request.get("channels"), list) else [],
        "pain_points": workflow_merchant.get("customerPainPoints") if isinstance(workflow_merchant.get("customerPainPoints"), list) else [],
    }

    targets = []
    for target in request.edge_targets:
        row = target.model_dump()
        row["skills"] = _normalize_skills(row.get("skills"))
        row["skill_commands"] = _normalize_commands(row.get("skill_commands"))
        targets.append(row)
    if not targets:
        for row in _edge_registry_map().values():
            if row.get("user_id") == request.user_id:
                targets.append(
                    {
                        "edge_id": row.get("edge_id"),
                        "account_id": row.get("account_id"),
                        "webhook_url": row.get("webhook_url"),
                        "skills": _normalize_skills(row.get("skills")),
                        "skill_manifest_path": row.get("skill_manifest_path"),
                        "skill_commands": _normalize_commands(row.get("skill_commands")),
                        "skill_manifest_meta": row.get("skill_manifest_meta") or {},
                    }
                )

    industry_tag = _resolve_industry_tag_for_task(
        task_description=request.task_description,
        competitor_handles=effective_competitor_handles,
        industry_tag_hint=request_industry_hint or workflow_industry_tag_hint,
    )
    _ensure_industry_profile_seed(
        tenant_id=current_user.tenant_id,
        industry_tag=industry_tag,
        actor_user_id=request.user_id,
    )
    industry_kb_context = _load_industry_kb_context(
        tenant_id=current_user.tenant_id,
        industry_tag=industry_tag,
        task_description=request.task_description,
        limit=request.industry_kb_limit,
    )
    agent_extensions = list_agent_extension_profiles(tenant_id=current_user.tenant_id)
    enabled_extension_count = sum(1 for row in agent_extensions if bool(row.get("enabled", True)))
    skills_pool_summary = {
        "agents_total": len(agent_extensions),
        "agents_enabled": enabled_extension_count,
        "skills_total": sum(len(row.get("skills", []) or []) for row in agent_extensions),
        "nodes_total": sum(len(row.get("nodes", []) or []) for row in agent_extensions),
        "profile_version_set": sorted(
            {
                str(row.get("profile_version", "")).strip()
                for row in agent_extensions
                if str(row.get("profile_version", "")).strip()
            }
        ),
    }

    edge_scope = targets[0].get("edge_id") if targets else "central"
    thread_id = f"{request.user_id}_{edge_scope}"
    config = _graph_config(
        thread_id,
        run_type="run_dragon_team",
        user_id=request.user_id,
        extra={"edge_scope": edge_scope, "request_id": request_id},
    )

    kernel_report: dict[str, Any] = {
        "applied": False,
        "request_id": request_id,
        "reason": "kernel_disabled_or_not_in_gray",
    }
    risk_level = _kernel_classify_risk_level(
        task_description=request.task_description,
        competitor_handles=request.competitor_handles,
        edge_targets=targets,
    )
    kernel_apply, kernel_policy = _kernel_should_apply(
        tenant_id=current_user.tenant_id,
        request_id=request_id,
        risk_level=risk_level,
    )
    kernel_report["kernel_policy"] = kernel_policy
    kernel_report["risk_level"] = kernel_policy.get("risk_level", risk_level)
    if kernel_policy.get("allowlist_blocked"):
        kernel_report["reason"] = "tenant_not_in_allowlist"
    elif kernel_policy.get("window_inactive"):
        kernel_report["reason"] = "outside_rollout_window"
    elif not kernel_policy.get("bucket_hit", True):
        kernel_report["reason"] = "request_not_in_rollout_bucket"
    elif not kernel_policy.get("enabled", True):
        kernel_report["reason"] = "kernel_disabled_by_policy"
    if not kernel_apply:
        kernel_report["stage"] = "skipped"
        kernel_report["storage"] = _persist_kernel_report(
            tenant_id=current_user.tenant_id,
            user_id=request.user_id,
            trace_id=request_id,
            stage="skipped",
            report=kernel_report,
        )

    force_hitl = False
    force_hitl_reason: str | None = None
    if kernel_apply:
        kernel_report = _kernel_preflight_report(
            tenant_id=current_user.tenant_id,
            user_id=request.user_id,
            request_id=request_id,
            task_description=request.task_description,
            competitor_handles=request.competitor_handles,
            edge_target_count=len(targets),
            kernel_policy=kernel_policy,
        )
        kernel_report["applied"] = True
        app.state.kernel_reports[request_id] = kernel_report
        kernel_report["storage"] = _persist_kernel_report(
            tenant_id=current_user.tenant_id,
            user_id=request.user_id,
            trace_id=request_id,
            stage="preflight",
            report=kernel_report,
        )
        guardian_decision = str((kernel_report.get("guardian") or {}).get("decision") or "review")
        verification_accepted = bool((kernel_report.get("verification") or {}).get("accepted"))
        _remember_event(
            user_id=request.user_id,
            trace_id=request_id,
            node="kernel.preflight",
            event_type="evaluated",
            payload={
                "guardian_decision": guardian_decision,
                "verification_accepted": verification_accepted,
                "confidence": kernel_report.get("confidence", {}),
                "source_credibility": (kernel_report.get("source_credibility") or {}).get("overall"),
            },
            level="warning" if guardian_decision in {"review", "block"} else "info",
        )
        if guardian_decision == "block" and _kernel_effective_block_mode(kernel_policy) == "deny":
            _persist_kernel_report(
                tenant_id=current_user.tenant_id,
                user_id=request.user_id,
                trace_id=request_id,
                stage="denied",
                report={**kernel_report, "stage": "denied"},
            )
            _remember_event(
                user_id=request.user_id,
                trace_id=request_id,
                node="kernel.preflight",
                event_type="denied",
                payload={"reason": "guardian_block_and_deny_mode"},
                level="error",
            )
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "kernel_denied",
                    "reason": "Blocked by constitutional guardian",
                    "kernel_report": kernel_report,
                },
            )
        if guardian_decision in {"review", "block"} or (not verification_accepted):
            force_hitl = True
            force_hitl_reason = (
                f"Kernel preflight requires HITL: guardian={guardian_decision}, "
                f"verification={verification_accepted}"
            )

    expanded_task_description = request.task_description
    query_expansion_payload: dict[str, Any] = {
        "original": request.task_description,
        "intent_summary": request.task_description,
        "expanded": [],
        "skipped": True,
        "method": "disabled",
        "reason": "",
    }
    try:
        from query_expander import QueryExpander

        query_expansion = await QueryExpander().expand(
            request.task_description,
            tenant_id=current_user.tenant_id,
            trace_id=request_id,
        )
        query_expansion_payload = query_expansion.to_dict()
        if not query_expansion.skipped and query_expansion.expanded:
            expanded_task_description = QueryExpander().format_for_task_description(query_expansion)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Query expander skipped due to error: %s", exc)

    payload = {
        "trace_id": request_id,
        "task_description": expanded_task_description,
        "user_id": request.user_id,
        "tenant_id": current_user.tenant_id,
        "industry": request_industry_hint or industry_tag,
        "industry_tag": industry_tag,
        "industry_workflow_context": workflow_context,
        "industry_workflow_digest": industry_workflow_digest,
        "industry_kb_context": industry_kb_context.get("references", []),
        "competitor_handles": effective_competitor_handles,
        "target_account_url": effective_competitor_handles[0] if effective_competitor_handles else "",
        "analysis_mode": False,
        "edge_targets": targets,
        "messages": [],
        "delivery_results": [],
        "source_credibility": kernel_report.get("source_credibility", {}),
        "memory_context": kernel_report.get("memory_context", {}),
        "strategy_confidence": kernel_report.get("confidence", {}),
        "hitl_required": force_hitl,
        "hitl_reason": force_hitl_reason,
        "agent_extensions": agent_extensions,
        "skills_pool_summary": skills_pool_summary,
        "query_expansion": query_expansion_payload,
    }
    _remember_event(
        user_id=request.user_id,
        trace_id=request_id,
        node="api.run_dragon_team",
        event_type="request_started",
        payload={
            "thread_id": thread_id,
            "edge_target_count": len(targets),
            "industry_tag": industry_tag,
            "industry_kb_hits": int(industry_kb_context.get("count", 0) or 0),
            "agent_extensions_enabled": enabled_extension_count,
            "client_preview_present": bool(request.client_preview),
            "industry_workflow_present": bool(request.industry_workflow_context),
            "query_expansion_method": query_expansion_payload.get("method"),
            "query_expansion_count": len(query_expansion_payload.get("expanded", []) or []),
            "industry_workflow_id": (
                str(request.industry_workflow_context.get("request", {}).get("workflowId") or "")
                if isinstance(request.industry_workflow_context.get("request"), dict)
                else ""
            ),
        },
        level="info",
    )

    try:
        result = await _invoke_dynamic_graph(
            goal=expanded_task_description,
            payload=payload,
            config=config,
            industry_context={
                "tenant_id": current_user.tenant_id,
                "user_id": request.user_id,
                "industry": request_industry_hint or industry_tag,
                "industry_tag": industry_tag,
            },
        )
        strategy_obj = result.get("strategy", {}) if isinstance(result.get("strategy"), dict) else {}
        runtime_confidence = strategy_obj.get("confidence_interval", {})
        post_source = result.get("source_credibility", kernel_report.get("source_credibility", {}))
        post_memory = result.get("memory_context", kernel_report.get("memory_context", {}))
        post_confidence = runtime_confidence if isinstance(runtime_confidence, dict) and runtime_confidence else kernel_report.get("confidence", {})
        post_guardian = kernel_constitutional_guardian(
            task_description=request.task_description,
            strategy=strategy_obj or {"strategy_summary": request.task_description[:240]},
            source_credibility=post_source if isinstance(post_source, dict) else {},
            memory_context=post_memory if isinstance(post_memory, dict) else {},
        )
        post_verification = kernel_verification_gate(
            confidence=post_confidence if isinstance(post_confidence, dict) else {},
            guardian=post_guardian,
            source_credibility=post_source if isinstance(post_source, dict) else {},
        )
        risk_taxonomy = kernel_classify_risk_taxonomy(
            task_description=request.task_description,
            strategy=strategy_obj or {"strategy_summary": request.task_description[:240]},
            guardian=post_guardian,
            verification=post_verification,
            edge_target_count=len(targets),
            competitor_count=len(request.competitor_handles),
        )
        autonomy = _kernel_autonomy_snapshot(
            guardian=post_guardian,
            verification=post_verification,
            block_mode=_kernel_effective_block_mode(kernel_policy),
            hitl_required=bool(result.get("hitl_required", False)),
            hitl_decision=str(result.get("hitl_decision") or ""),
            request_started_at=str(kernel_report.get("generated_at") or kernel_report.get("request_started_at") or ""),
            decision_updated_at=datetime.now(timezone.utc).isoformat(),
        )
        post_persisted = kernel_persist_memory(
            tenant_id=current_user.tenant_id,
            user_id=request.user_id,
            trace_id=request_id,
            task_description=request.task_description,
            strategy=strategy_obj or {"strategy_summary": request.task_description[:240]},
            guardian=post_guardian,
            verification=post_verification,
            confidence=post_confidence if isinstance(post_confidence, dict) else {},
        )
        final_kernel_report = {
            **kernel_report,
            "stage": "postgraph",
            "runtime": {
                "hitl_required": bool(result.get("hitl_required", False)),
                "hitl_decision": result.get("hitl_decision"),
                "score": float(result.get("score", 0) or 0),
                "strategy_confidence_interval": runtime_confidence if isinstance(runtime_confidence, dict) else {},
                "source_credibility": post_source,
                "memory_context": post_memory,
            },
            "post_guardian": post_guardian,
            "post_verification": post_verification,
            "risk_taxonomy": risk_taxonomy,
            "autonomy": autonomy,
            "client_preview": request.client_preview,
            "industry_workflow_context": request.industry_workflow_context,
            "industry_workflow_digest": industry_workflow_digest,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "post_persisted": post_persisted,
        }
        final_kernel_report["storage"] = _persist_kernel_report(
            tenant_id=current_user.tenant_id,
            user_id=request.user_id,
            trace_id=request_id,
            stage="postgraph",
            report=final_kernel_report,
        )
        app.state.kernel_reports[request_id] = final_kernel_report
        kb_hits = int(industry_kb_context.get("count", 0) or 0)
        kb_references = list(industry_kb_context.get("references", []) or [])
        kb_requested = int(request.industry_kb_limit or 0)
        score_value = float(result.get("score", 0) or 0)
        strategy_version = str((kernel_policy or {}).get("strategy_version") or "")
        industry_kb_metrics = industry_kb_record_run_metrics(
            tenant_id=current_user.tenant_id,
            user_id=request.user_id,
            trace_id=request_id,
            industry_tag=industry_tag,
            kb_hits=kb_hits,
            kb_requested=kb_requested,
            run_score=score_value,
            references=kb_references,
            strategy_version=strategy_version,
        )
        kb_preview = [
            {
                "entry_type": str(ref.get("entry_type") or ""),
                "title": str(ref.get("title") or "")[:120],
                "effect_score": float(ref.get("effect_score", 0) or 0),
                "source_account": str(ref.get("source_account") or "")[:120],
            }
            for ref in kb_references[:8]
        ]
        leads_payload = result.get("leads", []) if isinstance(result.get("leads"), list) else []
        followup_spawn_payload = result.get("followup_spawn", {}) if isinstance(result.get("followup_spawn"), dict) else {}
        lead_conversion: dict[str, Any] = {}
        try:
            from customer_mind_map import get_customer_mind_map_store
            fsm = get_lead_conversion_fsm()
            mind_map_store = get_customer_mind_map_store()
            for lead in leads_payload:
                if not isinstance(lead, dict):
                    continue
                lead_id = str(lead.get("lead_id") or "").strip()
                if not lead_id:
                    continue
                mind_map = mind_map_store.get_or_create(current_user.tenant_id, lead_id)
                basic_facts = []
                for key in ("company", "industry", "channel", "grade", "intent"):
                    value = str(lead.get(key) or "").strip()
                    if value:
                        basic_facts.append(f"{key}: {value}")
                if basic_facts:
                    mind_map.update_node(
                        dimension="basic_info",
                        new_facts=basic_facts,
                        answered_questions=["公司规模？" if str(lead.get("company") or "").strip() else ""],
                        source="commander",
                        confidence=0.72,
                    )
                    mind_map_store.save(mind_map)
                target_status, confidence, trigger = fsm.infer_target_status(
                    lead=lead,
                    followup_spawn=followup_spawn_payload or None,
                )
                transition = fsm.transition(
                    tenant_id=current_user.tenant_id,
                    lead_id=lead_id,
                    target_status=target_status,
                    trigger=trigger,
                    confidence=confidence,
                    triggered_by="commander",
                    evidence=str(lead.get("summary") or lead.get("text") or lead.get("intent") or "")[:200],
                )
                state = fsm.get_status(current_user.tenant_id, lead_id)
                lead["conversion_status"] = state.get("status")
                lead["conversion_confidence"] = state.get("confidence")
                lead_conversion[lead_id] = {
                    "state": state,
                    "transition": transition.to_dict() if transition else None,
                }
        except Exception as conversion_exc:
            logger.warning("Lead conversion FSM update skipped: %s", conversion_exc)
        response = TaskResponse(
            status="success",
            request_id=request_id,
            thread_id=thread_id,
            industry_tag=industry_tag,
            query_expansion=query_expansion_payload,
            survey_suggestions=_survey_suggestions_for_event(
                "lobster_task_completed",
                current_user=current_user,
                task_id=request_id,
            ),
            industry_kb_context=kb_references,
            industry_kb_metrics=industry_kb_metrics,
            score=score_value,
            hot_topics=result.get("hot_topics", []),
            competitor_analysis=result.get("competitor_analysis", {}),
            content_package=result.get("content_package", {}),
            delivery_results=result.get("delivery_results", []),
            leads=leads_payload,
            lead_conversion=lead_conversion,
            competitor_formulas=result.get("competitor_formulas", []),
            competitor_multimodal_assets=result.get("competitor_multimodal_assets", []),
            rag_mode=result.get("rag_mode"),
            rag_ingested_count=int(result.get("rag_ingested_count", 0) or 0),
            dispatch_plan=result.get("dispatch_plan", {}),
            edge_skill_plan=result.get("edge_skill_plan", {}),
            clawteam_queue=result.get("clawteam_queue", {}),
            followup_spawn=result.get("followup_spawn", {}),
            policy_bandit=result.get("policy_bandit", {}),
            constitutional_guardian=result.get("constitutional_guardian", {}),
            verification_gate=result.get("verification_gate", {}),
            memory_governor=result.get("memory_governor", {}),
            agent_extensions=agent_extensions,
            skills_pool_summary=skills_pool_summary,
            publish_allowed=bool(result.get("publish_allowed", False)),
            reason_codes=result.get("reason_codes", []),
            confidence_band=result.get("confidence_band"),
            hitl_required=bool(result.get("hitl_required", False)),
            hitl_decision=result.get("hitl_decision"),
            hitl_approval_id=result.get("hitl_approval_id"),
            hitl_reason=result.get("hitl_reason"),
            kernel_report=final_kernel_report,
            call_log=result.get("call_log", []),
            evolution=result.get("evolution_log", []),
        )
        usage_tokens = _estimate_tokens_from_payload(
            {
                "task": request.task_description,
                "strategy": result.get("strategy", {}),
                "content_package": result.get("content_package", {}),
                "delivery_results": result.get("delivery_results", []),
            }
        )
        await report_usage(
            user_id=current_user.sub,
            tenant_id=current_user.tenant_id,
            event_type="run_dragon_team",
            path="/run-dragon-team",
            runs=1,
            tokens=usage_tokens,
            trace_id=request_id,
            metadata={
                "thread_id": thread_id,
                "edge_target_count": len(targets),
                "rag_mode": result.get("rag_mode"),
                "score": result.get("score", 0),
                "industry_tag": industry_tag,
                "industry_kb_hits": kb_hits,
                "industry_kb_hit_rate": float(industry_kb_metrics.get("industry_kb_hit_rate", 0) or 0),
                "industry_kb_effect_delta": float(industry_kb_metrics.get("industry_kb_effect_delta", 0) or 0),
            },
        )
        _remember_event(
            user_id=request.user_id,
            trace_id=request_id,
            node="api.run_dragon_team",
            event_type="request_succeeded",
            payload={
                "thread_id": thread_id,
                "score": float(result.get("score", 0) or 0),
                "rag_mode": result.get("rag_mode"),
                "delivery_count": len(result.get("delivery_results", []) or []),
                "industry_tag": industry_tag,
                "industry_kb_hits": kb_hits,
                "industry_kb_requested": kb_requested,
                "industry_kb_hit_rate": float(industry_kb_metrics.get("industry_kb_hit_rate", 0) or 0),
                "industry_kb_effect_delta": float(industry_kb_metrics.get("industry_kb_effect_delta", 0) or 0),
                "industry_kb_hits_detail": kb_preview,
                "agent_extensions_enabled": enabled_extension_count,
                "skills_pool_summary": skills_pool_summary,
                "query_expansion": query_expansion_payload,
                "kernel_guardian": ((kernel_report.get("guardian") or {}).get("decision") if kernel_report else None),
                "kernel_verification": (
                    (kernel_report.get("verification") or {}).get("accepted") if kernel_report else None
                ),
                "industry_workflow_context": request.industry_workflow_context,
            },
            level="info",
        )
        _schedule_post_mission_intent_prediction(
            tenant_id=current_user.tenant_id,
            task_id=request_id,
            task_summary=json.dumps(
                {
                    "task": request.task_description,
                    "score": score_value,
                    "industry_tag": industry_tag,
                    "hot_topics": result.get("hot_topics", []),
                    "delivery_count": len(result.get("delivery_results", []) or []),
                    "lead_count": len(result.get("leads", []) or []),
                },
                ensure_ascii=False,
            ),
        )
        try:
            _record_posthog_analytics_run(
                run_id=request_id,
                tenant_id=current_user.tenant_id,
                request=request,
                result=result,
            )
        except Exception as analytics_exc:  # noqa: BLE001
            logger.warning("PostHog analytics record skipped: %s", analytics_exc)
        return response
    except Exception as exc:  # noqa: BLE001
        _remember_event(
            user_id=request.user_id,
            trace_id=request_id,
            node="api.run_dragon_team",
            event_type="request_failed",
            payload={"thread_id": thread_id, "error": str(exc)},
            level="error",
        )
        raise HTTPException(status_code=500, detail=f"Dragon team execution failed: {exc}") from exc


async def _run_dragon_team_async_job(job_id: str, request: TaskRequest, current_user: UserClaims) -> None:
    await _update_run_job_record(
        job_id,
        status="running",
        started_at=datetime.now(timezone.utc).isoformat(),
    )
    try:
        response = await run_dragon_team(request, current_user)
        result = response.model_dump() if hasattr(response, "model_dump") else dict(response)
        await _update_run_job_record(
            job_id,
            status="completed",
            completed_at=datetime.now(timezone.utc).isoformat(),
            request_id=str(result.get("request_id") or ""),
            thread_id=str(result.get("thread_id") or ""),
            result=result,
            error=None,
        )
    except HTTPException as exc:
        await _update_run_job_record(
            job_id,
            status="failed",
            completed_at=datetime.now(timezone.utc).isoformat(),
            error={"status_code": exc.status_code, "detail": exc.detail},
        )
    except Exception as exc:  # noqa: BLE001
        await _update_run_job_record(
            job_id,
            status="failed",
            completed_at=datetime.now(timezone.utc).isoformat(),
            error={"status_code": 500, "detail": str(exc)},
        )


@app.post("/run-dragon-team-async", response_model=TaskAsyncAcceptedResponse)
async def run_dragon_team_async(request: TaskRequest, current_user: UserClaims = Depends(_decode_user)):
    if current_user.sub != request.user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="user_id mismatch with login user")

    request_id = str(uuid.uuid4())
    job_id = f"rdj_{uuid.uuid4().hex[:12]}"
    record = {
        "job_id": job_id,
        "request_id": request_id,
        "status": "queued",
        "status_url": f"/run-dragon-team-async/{job_id}",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "user_id": request.user_id,
        "tenant_id": current_user.tenant_id,
        "task_description": request.task_description[:240],
        "industry_tag": request.industry or request.industry_tag,
        "edge_target_count": len(request.edge_targets),
        "mode": "async",
    }
    await _store_run_job_record(record)

    task = asyncio.create_task(_run_dragon_team_async_job(job_id, request.model_copy(deep=True), current_user.model_copy(deep=True)))
    app.state.run_dragon_background_tasks.add(task)
    task.add_done_callback(lambda done_task: app.state.run_dragon_background_tasks.discard(done_task))

    return TaskAsyncAcceptedResponse(
        job_id=job_id,
        status="queued",
        status_url=f"/run-dragon-team-async/{job_id}",
        request_id=request_id,
    )


@app.get("/run-dragon-team-async/{job_id}", response_model=TaskAsyncStatusResponse)
async def run_dragon_team_async_status(job_id: str, current_user: UserClaims = Depends(_decode_user)):
    record = await _read_run_job_record(job_id.strip())
    if not record:
        raise HTTPException(status_code=404, detail="job_id not found")
    if str(record.get("user_id") or "") != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    return TaskAsyncStatusResponse(
        job_id=str(record.get("job_id") or job_id),
        status=str(record.get("status") or "unknown"),
        request_id=str(record.get("request_id") or ""),
        created_at=str(record.get("created_at") or ""),
        updated_at=str(record.get("updated_at") or ""),
        started_at=str(record.get("started_at") or "") or None,
        completed_at=str(record.get("completed_at") or "") or None,
        user_id=str(record.get("user_id") or ""),
        tenant_id=str(record.get("tenant_id") or ""),
        thread_id=str(record.get("thread_id") or "") or None,
        result=record.get("result") if isinstance(record.get("result"), dict) else None,
        error=record.get("error") if isinstance(record.get("error"), dict) else None,
    )


@app.post("/analyze_competitor_formula", response_model=AnalyzeCompetitorFormulaResponse)
async def analyze_competitor_formula(
    request: AnalyzeCompetitorFormulaRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = request.user_id or current_user.sub
    if current_user.sub != effective_user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="user_id mismatch with login user")

    request_id = str(uuid.uuid4())
    thread_id = f"{effective_user_id}_formula"
    config = _graph_config(
        thread_id,
        run_type="analyze_competitor_formula",
        user_id=effective_user_id,
        extra={"request_id": request_id},
    )

    competitor_handles = request.competitor_handles or [request.target_account_url]
    payload = {
        "trace_id": request_id,
        "task_description": f"Analyze competitor formula for {request.target_account_url}",
        "user_id": effective_user_id,
        "competitor_handles": competitor_handles,
        "target_account_url": request.target_account_url,
        "analysis_mode": True,
        "edge_targets": [],
        "messages": [],
        "delivery_results": [],
    }
    _remember_event(
        user_id=effective_user_id,
        trace_id=request_id,
        node="api.analyze_competitor_formula",
        event_type="request_started",
        payload={"thread_id": thread_id, "target_account_url": request.target_account_url},
        level="info",
    )

    try:
        result = await _invoke_dynamic_graph(
            goal=f"competitor analyze {request.target_account_url} 竞品 信号 扫描",
            payload=payload,
            config=config,
            industry_context={"tenant_id": current_user.tenant_id, "user_id": effective_user_id},
        )
        detected_industry = _resolve_industry_tag_for_task(
            task_description=f"competitor analyze {request.target_account_url}",
            competitor_handles=competitor_handles,
            industry_tag_hint=None,
        )
        formula_rows = result.get("competitor_formulas", []) if isinstance(result.get("competitor_formulas"), list) else []
        auto_ingest_row = industry_kb_ingest_competitor_formulas(
            tenant_id=current_user.tenant_id,
            industry_tag=detected_industry,
            formulas=formula_rows,
            source_account=request.target_account_url,
            trace_id=request_id,
            actor_user_id=effective_user_id,
        )
        response = AnalyzeCompetitorFormulaResponse(
            status="success",
            request_id=request_id,
            thread_id=thread_id,
            target_account_url=request.target_account_url,
            competitor_formulas=formula_rows,
            competitor_multimodal_assets=result.get("competitor_multimodal_assets", []),
            rag_mode=result.get("rag_mode"),
            rag_ingested_count=int(result.get("rag_ingested_count", 0) or 0),
            call_log=result.get("call_log", []),
            evolution=result.get("evolution_log", []),
        )
        usage_tokens = _estimate_tokens_from_payload(
            {
                "target_account_url": request.target_account_url,
                "formulas": result.get("competitor_formulas", []),
                "assets": result.get("competitor_multimodal_assets", []),
            }
        )
        await report_usage(
            user_id=effective_user_id,
            tenant_id=current_user.tenant_id,
            event_type="analyze_competitor_formula",
            path="/analyze_competitor_formula",
            runs=1,
            tokens=usage_tokens,
            trace_id=request_id,
            metadata={
                "thread_id": thread_id,
                "formula_count": len(result.get("competitor_formulas", []) or []),
                "asset_count": len(result.get("competitor_multimodal_assets", []) or []),
                "rag_mode": result.get("rag_mode"),
                "industry_tag": detected_industry,
                "industry_kb_ingested_count": auto_ingest_row.get("ingested_count", 0),
            },
        )
        _remember_event(
            user_id=effective_user_id,
            trace_id=request_id,
            node="api.analyze_competitor_formula",
            event_type="request_succeeded",
            payload={
                "thread_id": thread_id,
                "formula_count": len(result.get("competitor_formulas", []) or []),
                "asset_count": len(result.get("competitor_multimodal_assets", []) or []),
                "rag_mode": result.get("rag_mode"),
                "industry_tag": detected_industry,
                "industry_kb_ingested_count": auto_ingest_row.get("ingested_count", 0),
            },
            level="info",
        )
        return response
    except Exception as exc:  # noqa: BLE001
        _remember_event(
            user_id=effective_user_id,
            trace_id=request_id,
            node="api.analyze_competitor_formula",
            event_type="request_failed",
            payload={"thread_id": thread_id, "error": str(exc)},
            level="error",
        )
        raise HTTPException(status_code=500, detail=f"Competitor formula analysis failed: {exc}") from exc


@app.post("/receive_dm_from_edge", dependencies=[Depends(_verify_edge_secret)])
async def receive_dm_from_edge(body: EdgeDmRequest):
    trace_id = f"dm_{body.edge_id}_{int(time.time())}"
    try:
        result = await _run_dm_pipeline(
            edge_id=body.edge_id,
            account_id=body.account_id,
            dm_text=body.dm_text,
            user_id_hint=None,
        )
        effective_trace_id = str(result.get("trace_id") or trace_id)
        edge_info = app.state.edge_registry.get(body.edge_id, {})
        usage_user = str(edge_info.get("user_id") or body.account_id)
        usage_tenant = str(edge_info.get("tenant_id") or "tenant_main")
        await report_usage(
            user_id=usage_user,
            tenant_id=usage_tenant,
            event_type="receive_dm_from_edge",
            path="/receive_dm_from_edge",
            runs=1,
            tokens=_estimate_tokens_from_payload({"dm_text": body.dm_text, "result": result}),
            trace_id=effective_trace_id,
            metadata={"edge_id": body.edge_id, "account_id": body.account_id},
        )
        _remember_event(
            user_id=usage_user,
            trace_id=effective_trace_id,
            node="api.receive_dm_from_edge",
            event_type="dm_processed",
            payload={
                "edge_id": body.edge_id,
                "account_id": body.account_id,
                "score": result.get("score", 0),
                "thread_id": result.get("thread_id"),
                "trace_id": effective_trace_id,
            },
            level="info",
        )
        return result
    except Exception as exc:  # noqa: BLE001
        _remember_event(
            user_id=str(body.account_id),
            trace_id=trace_id,
            node="api.receive_dm_from_edge",
            event_type="dm_failed",
            payload={"edge_id": body.edge_id, "account_id": body.account_id, "error": str(exc)},
            level="error",
        )
        raise HTTPException(status_code=500, detail=f"DM pipeline failed: {exc}") from exc


@app.get("/status/{user_id}")
async def get_status(user_id: str, current_user: UserClaims = Depends(_decode_user)):
    if current_user.sub != user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")

    registered_edges = [
        row for row in _edge_registry_map().values() if row.get("user_id") == user_id
    ]
    known_skills = sorted(
        {
            str(skill).strip().lower()
            for row in registered_edges
            for skill in (row.get("skills") or [])
            if str(skill).strip()
        }
    )
    known_commands = sorted(
        {
            re.sub(r"\s+", " ", str(command)).strip()
            for row in registered_edges
            for command in (row.get("skill_commands") or [])
            if str(command).strip()
        }
    )
    return {
        "status": "central_and_edge_pipeline_ready",
        "user_id": user_id,
        "registered_edges": registered_edges,
        "known_edge_skills": known_skills[:50],
        "known_edge_commands": known_commands[:50],
        "pending_outbox": _edge_outbox_pending_counts(),
    }


@app.get("/memory/events")
async def memory_events(
    user_id: str | None = Query(default=None),
    trace_id: str | None = Query(default=None),
    keyword: str | None = Query(default=None),
    errors_only: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    events = lossless_query_events(
        user_id=effective_user_id,
        trace_id=trace_id,
        keyword=keyword,
        errors_only=errors_only,
        limit=limit,
    )
    return {"ok": True, "count": len(events), "events": events}


@app.get("/memory/trace/{trace_id}")
async def memory_trace(
    trace_id: str,
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    snapshot = lossless_trace_snapshot(user_id=effective_user_id, trace_id=trace_id)
    industry = industry_kb_trace_snapshot(
        tenant_id=current_user.tenant_id,
        trace_id=trace_id,
    )
    return {"ok": True, "trace": snapshot, "industry_kb": industry}


@app.get("/memory/replay/{trace_id}")
async def memory_replay(
    trace_id: str,
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    replay = lossless_replay_trace(user_id=effective_user_id, trace_id=trace_id)
    industry = industry_kb_trace_snapshot(
        tenant_id=current_user.tenant_id,
        trace_id=trace_id,
    )
    return {"ok": True, "replay": replay, "industry_kb": industry}


def _memory_compressor_reader() -> MemoryCompressor:
    return MemoryCompressor(
        llm_call_fn=None,
        storage_dir=os.getenv("MEMORY_COMPRESSION_DIR", "./data/memory"),
    )


def _resolve_memory_tenant(target_tenant: str | None, current_user: UserClaims) -> str:
    tenant_id = str(target_tenant or current_user.tenant_id).strip() or current_user.tenant_id
    if tenant_id != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    return tenant_id


@app.get("/api/memory/wisdoms")
async def api_memory_wisdoms(
    tenant_id: str | None = Query(default=None),
    category: str | None = Query(default=None),
    lobster_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = _resolve_memory_tenant(tenant_id, current_user)
    compressor = _memory_compressor_reader()
    wisdoms = compressor.get_wisdoms(
        tenant_id=target_tenant,
        category=str(category or "").strip() or None,
        lobster_id=str(lobster_id or "").strip() or None,
        limit=limit,
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "count": len(wisdoms),
        "wisdoms": [asdict(item) for item in wisdoms],
    }


@app.get("/api/memory/reports")
async def api_memory_reports(
    tenant_id: str | None = Query(default=None),
    lobster_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = _resolve_memory_tenant(tenant_id, current_user)
    compressor = _memory_compressor_reader()
    reports = compressor.get_reports(
        tenant_id=target_tenant,
        lobster_id=str(lobster_id or "").strip() or None,
        limit=limit,
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "count": len(reports),
        "reports": [asdict(item) for item in reports],
    }


@app.get("/api/memory/stats")
async def api_memory_stats(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = _resolve_memory_tenant(tenant_id, current_user)
    compressor = _memory_compressor_reader()
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "stats": compressor.get_stats(tenant_id=target_tenant),
    }


@app.post("/api/v1/memory/hybrid-search")
async def api_v1_memory_hybrid_search(
    body: HybridMemorySearchRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = _resolve_memory_tenant(body.tenant_id, current_user)
    effective_node_id = str(body.node_id or body.lobster_name or "").strip()
    if not effective_node_id:
        raise HTTPException(status_code=400, detail="node_id or lobster_name is required")

    service_url = _memory_service_base_url()
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                f"{service_url}/memory/retrieve",
                json={
                    "node_id": effective_node_id,
                    "current_task": body.query,
                    "top_k": body.top_k,
                    "tenant_id": target_tenant,
                    "lobster_name": str(body.lobster_name or "").strip() or None,
                    "memory_type": body.memory_type,
                    "days": body.days,
                    "use_hybrid": True,
                },
            )
            response.raise_for_status()
            payload = response.json()
        return {
            "ok": True,
            "backend": "lobster-memory-service",
            "query": body.query,
            "items": payload.get("memories", []),
        }
    except Exception:
        fallback_lobster = str(body.lobster_name or "commander").strip() or "commander"
        lobster = _build_runtime_lobster(fallback_lobster, target_tenant)
        fallback = await lobster.memory.recall(query=body.query, category=body.memory_type, top_k=body.top_k) if hasattr(lobster, "memory") else []
        return {
            "ok": True,
            "backend": "fallback_file_memory",
            "query": body.query,
            "items": [
                {
                    "final_score": float(item.get("score") or 0),
                    "memory_details": {
                        "content": item.get("content"),
                        "category": item.get("category"),
                        "path": item.get("path"),
                        "metadata": item.get("metadata") or {},
                    },
                }
                for item in fallback
            ],
        }


@app.post("/api/v1/vector-backup/trigger")
async def api_v1_vector_backup_trigger(
    body: VectorBackupTriggerRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    manager = VectorSnapshotManager()
    collections = [item for item in (body.collections or []) if str(item).strip()]
    if collections:
        original = os.getenv("VECTOR_BACKUP_COLLECTIONS", "")
        os.environ["VECTOR_BACKUP_COLLECTIONS"] = ",".join(collections)
        try:
            result = manager.run_daily_backup()
        finally:
            if original:
                os.environ["VECTOR_BACKUP_COLLECTIONS"] = original
            else:
                os.environ.pop("VECTOR_BACKUP_COLLECTIONS", None)
    else:
        result = manager.run_daily_backup()
    return {"ok": True, **result}


@app.get("/api/v1/vector-backup/snapshots/{collection_name}")
async def api_v1_vector_backup_snapshots(
    collection_name: str,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    manager = VectorSnapshotManager()
    return {
        "ok": True,
        "collection_name": collection_name,
        "snapshots": manager.list_remote_snapshots(collection_name),
    }


@app.get("/api/v1/vector-backup/history")
async def api_v1_vector_backup_history(
    collection_name: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    manager = VectorSnapshotManager()
    return {
        "ok": True,
        "items": manager.list_backup_history(collection_name=collection_name, limit=limit),
    }


def _ensure_tenant_scope(path_tenant_id: str, current_user: UserClaims) -> None:
    if path_tenant_id != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")


@app.get("/api/v1/memory/{tenant_id}/{lobster_id}/stats")
async def api_v1_memory_stats(
    tenant_id: str,
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    lobster = _build_runtime_lobster(lobster_id, tenant_id)
    stats = lobster.memory.get_stats() if hasattr(lobster, "memory") else {}
    return {"status": "success", "data": stats}


@app.get("/api/v1/memory/{tenant_id}/{lobster_id}/search")
async def api_v1_memory_search(
    tenant_id: str,
    lobster_id: str,
    query: str,
    category: str | None = Query(default=None),
    top_k: int = Query(default=5, ge=1, le=50),
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    lobster = _build_runtime_lobster(lobster_id, tenant_id)
    results = await lobster.memory.recall(query=query, category=category, top_k=top_k) if hasattr(lobster, "memory") else []
    return {"status": "success", "data": results}


@app.get("/api/v1/memory/{tenant_id}/{lobster_id}/{category}")
async def api_v1_memory_list_by_category(
    tenant_id: str,
    lobster_id: str,
    category: str,
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    lobster = _build_runtime_lobster(lobster_id, tenant_id)
    items = await lobster.memory.list_by_category(category) if hasattr(lobster, "memory") else []
    return {"status": "success", "data": items}


@app.delete("/api/v1/memory/{tenant_id}/{lobster_id}/{category}/{key}")
async def api_v1_memory_delete(
    tenant_id: str,
    lobster_id: str,
    category: str,
    key: str,
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    lobster = _build_runtime_lobster(lobster_id, tenant_id)
    deleted = await lobster.memory.forget(category, key) if hasattr(lobster, "memory") else False
    if not deleted:
        raise HTTPException(status_code=404, detail="memory_item_not_found")
    return {"status": "success"}


@app.get("/api/v1/graph/{tenant_id}/snapshot")
async def api_v1_graph_snapshot(
    tenant_id: str,
    lead_id: str | None = Query(default=None),
    reference_time: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    from temporal_knowledge_graph import get_temporal_graph_builder

    snapshot = await get_temporal_graph_builder().get_graph_snapshot(
        tenant_id=tenant_id,
        lead_id=str(lead_id or "").strip() or None,
        reference_time=reference_time,
    )
    return {"status": "success", "data": snapshot}


@app.get("/api/v1/graph/{tenant_id}/timeline")
async def api_v1_graph_timeline(
    tenant_id: str,
    entity_name: str,
    lead_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    from temporal_knowledge_graph import get_temporal_graph_builder

    items = await get_temporal_graph_builder().get_entity_timeline(
        tenant_id=tenant_id,
        entity_name=entity_name,
        lead_id=str(lead_id or "").strip() or None,
    )
    return {"status": "success", "data": items}


@app.get("/api/v1/leads/{tenant_id}/{lead_id}/conversion-status")
async def api_v1_lead_conversion_status(
    tenant_id: str,
    lead_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    return {
        "status": "success",
        "data": get_lead_conversion_fsm().get_status(tenant_id, lead_id),
    }


@app.get("/api/v1/leads/{tenant_id}/{lead_id}/conversion-history")
async def api_v1_lead_conversion_history(
    tenant_id: str,
    lead_id: str,
    limit: int = Query(default=20, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    return {
        "status": "success",
        "data": get_lead_conversion_fsm().list_history(tenant_id, lead_id, limit=limit),
    }


@app.get("/api/v1/tasks/{tenant_id}/{lobster_id}/pending")
async def api_v1_pending_tasks(
    tenant_id: str,
    lobster_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    _ensure_tenant_scope(tenant_id, current_user)
    from lobsters.lobster_memory import LobsterMemory
    from lobsters.task_continuity import TaskContinuityManager

    continuity = TaskContinuityManager(LobsterMemory(lobster_id, tenant_id))
    tasks = await continuity.get_pending_tasks(tenant_id, lobster_id)
    return {"status": "success", "data": tasks}


@app.get("/api/sessions")
async def api_list_sessions(
    peer_id: str | None = Query(default=None),
    lobster_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    sessions = session_mgr.list_sessions(
        peer_id=str(peer_id or "").strip() or None,
        lobster_id=str(lobster_id or "").strip() or None,
    )
    scoped = [
        item
        for item in sessions
        if str(item.get("tenant_id") or "") == current_user.tenant_id or "admin" in current_user.roles
    ]
    return {"ok": True, "count": len(scoped), "sessions": scoped}


@app.get("/api/sessions/{session_id}/history")
async def api_get_session_history(
    session_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    sessions = session_mgr.list_sessions()
    match = next((item for item in sessions if str(item.get("session_id")) == session_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    if str(match.get("tenant_id") or "") != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    return {"ok": True, "messages": session_mgr.get_history(session_id, limit)}


@app.delete("/api/sessions/{session_id}")
async def api_clear_session(
    session_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    sessions = session_mgr.list_sessions()
    match = next((item for item in sessions if str(item.get("session_id")) == session_id), None)
    if match is None:
        raise HTTPException(status_code=404, detail="session_not_found")
    if str(match.get("tenant_id") or "") != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    session_mgr.clear_session(session_id)
    return {"ok": True, "status": "cleared"}


@app.get("/kernel/rollout/policy")
async def kernel_rollout_policy(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = tenant_id or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    policy = _kernel_policy_for_tenant(target_tenant)
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "policy": policy,
        "window_active": _kernel_window_active(policy),
    }


@app.get("/kernel/rollout/templates")
async def kernel_rollout_templates(
    tenant_id: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = tenant_id or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    templates = memory_list_kernel_rollout_templates(target_tenant, limit=limit)
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "count": len(templates),
        "templates": templates,
    }


@app.get("/kernel/rollout/templates/export")
async def export_kernel_rollout_templates(
    tenant_id: str | None = Query(default=None),
    limit: int = Query(default=500, ge=1, le=2000),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = tenant_id or current_user.tenant_id
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")
    templates = memory_list_kernel_rollout_templates(target_tenant, limit=limit)
    return {
        "ok": True,
        "schema_version": "kernel_rollout_templates.v1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source_tenant_id": target_tenant,
        "count": len(templates),
        "templates": templates,
    }


@app.post("/kernel/rollout/templates")
async def save_kernel_rollout_template(
    body: KernelRolloutTemplateSaveRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = body.tenant_id or current_user.tenant_id
    template_name = str(body.template_name or "").strip()
    if not template_name:
        raise HTTPException(status_code=400, detail="template_name is required")
    template_key = _normalize_template_key(body.template_key, template_name)
    normalized_rollout = _kernel_normalize_risk_rollout(body.risk_rollout)
    row = memory_upsert_kernel_rollout_template(
        tenant_id=target_tenant,
        template_key=template_key,
        template_name=template_name,
        risk_rollout=normalized_rollout,
        note=body.note,
        updated_by=current_user.sub,
    )
    templates = memory_list_kernel_rollout_templates(target_tenant, limit=200)
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="kernel.rollout.template",
        event_type="saved",
        payload={
            "tenant_id": target_tenant,
            "template_key": template_key,
            "template_name": template_name,
            "risk_rollout": normalized_rollout,
        },
        level="warning",
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "template": {
            "template_key": template_key,
            "template_name": template_name,
            "risk_rollout": normalized_rollout,
            "note": body.note,
        },
        "storage": row,
        "templates": templates,
    }


@app.post("/kernel/rollout/templates/import")
async def import_kernel_rollout_templates(
    body: KernelRolloutTemplateImportRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = body.tenant_id or current_user.tenant_id
    source_tenant = body.source_tenant_id
    mode = str(body.mode or "upsert").strip().lower()

    imported_templates: list[KernelRolloutTemplateImportItem] = list(body.templates or [])
    if not imported_templates and source_tenant:
        rows = memory_list_kernel_rollout_templates(source_tenant, limit=2000)
        imported_templates = [
            KernelRolloutTemplateImportItem(
                template_key=str(row.get("template_key") or ""),
                template_name=str(row.get("template_name") or ""),
                risk_rollout=(row.get("risk_rollout") or {}),
                note=row.get("note"),
            )
            for row in rows
            if str(row.get("template_name") or "").strip()
        ]

    if not imported_templates:
        raise HTTPException(status_code=400, detail="No templates to import")

    existing = {
        str(item.get("template_key") or "")
        for item in memory_list_kernel_rollout_templates(target_tenant, limit=2000)
    }
    if mode == "replace_all":
        for key in list(existing):
            if key:
                memory_delete_kernel_rollout_template(tenant_id=target_tenant, template_key=key)
        existing = set()

    inserted = 0
    updated = 0
    skipped = 0
    for item in imported_templates:
        template_name = str(item.template_name or "").strip()
        if not template_name:
            continue
        normalized_key = _normalize_template_key(item.template_key, template_name)
        if mode == "skip_existing" and normalized_key in existing:
            skipped += 1
            continue
        row = memory_upsert_kernel_rollout_template(
            tenant_id=target_tenant,
            template_key=normalized_key,
            template_name=template_name,
            risk_rollout=_kernel_normalize_risk_rollout(item.risk_rollout),
            note=item.note,
            updated_by=current_user.sub,
        )
        if row.get("inserted"):
            inserted += 1
        else:
            updated += 1
        existing.add(normalized_key)

    templates = memory_list_kernel_rollout_templates(target_tenant, limit=2000)
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="kernel.rollout.template",
        event_type="imported",
        payload={
            "tenant_id": target_tenant,
            "source_tenant_id": source_tenant,
            "mode": mode,
            "inserted": inserted,
            "updated": updated,
            "skipped": skipped,
        },
        level="warning",
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "mode": mode,
        "source_tenant_id": source_tenant,
        "inserted": inserted,
        "updated": updated,
        "skipped": skipped,
        "count": len(templates),
        "templates": templates,
    }


@app.patch("/kernel/rollout/templates/{template_key}")
async def rename_kernel_rollout_template(
    template_key: str,
    body: KernelRolloutTemplateRenameRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = body.tenant_id or current_user.tenant_id
    source_key = _normalize_template_key(template_key, template_key)
    next_key = _normalize_template_key(body.new_template_key, body.new_template_key or source_key)
    if not source_key:
        raise HTTPException(status_code=400, detail="template_key is required")
    renamed = memory_rename_kernel_rollout_template(
        tenant_id=target_tenant,
        template_key=source_key,
        new_template_key=next_key,
        template_name=body.template_name,
        note=body.note,
        updated_by=current_user.sub,
    )
    if not renamed.get("updated"):
        reason = str(renamed.get("reason") or "rename_failed")
        if reason == "not_found":
            raise HTTPException(status_code=404, detail="template not found")
        if reason == "template_key_conflict":
            raise HTTPException(status_code=409, detail="template_key already exists")
        if reason == "invalid_template_name":
            raise HTTPException(status_code=400, detail="template_name is invalid")
        raise HTTPException(status_code=400, detail=reason)

    templates = memory_list_kernel_rollout_templates(target_tenant, limit=200)
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="kernel.rollout.template",
        event_type="renamed",
        payload={
            "tenant_id": target_tenant,
            "old_template_key": source_key,
            "template_key": renamed.get("template_key"),
            "template_name": renamed.get("template_name"),
        },
        level="warning",
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "template": renamed,
        "templates": templates,
    }


@app.delete("/kernel/rollout/templates/{template_key}")
async def delete_kernel_rollout_template(
    template_key: str,
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = tenant_id or current_user.tenant_id
    source_key = _normalize_template_key(template_key, template_key)
    if not source_key:
        raise HTTPException(status_code=400, detail="template_key is required")
    deleted = memory_delete_kernel_rollout_template(tenant_id=target_tenant, template_key=source_key)
    if not deleted.get("deleted"):
        raise HTTPException(status_code=404, detail="template not found")

    templates = memory_list_kernel_rollout_templates(target_tenant, limit=200)
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="kernel.rollout.template",
        event_type="deleted",
        payload={"tenant_id": target_tenant, "template_key": source_key},
        level="warning",
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "deleted": True,
        "template_key": source_key,
        "templates": templates,
    }


@app.put("/kernel/rollout/policy")
async def update_kernel_rollout_policy(
    body: KernelRolloutPolicyUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    if "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Admin role required")
    target_tenant = body.tenant_id or current_user.tenant_id
    start_dt = _parse_dt(body.window_start_utc)
    end_dt = _parse_dt(body.window_end_utc)
    if start_dt and end_dt and start_dt > end_dt:
        raise HTTPException(status_code=400, detail="window_start_utc must be <= window_end_utc")
    row = memory_upsert_kernel_rollout_policy(
        tenant_id=target_tenant,
        enabled=body.enabled,
        rollout_ratio=body.rollout_ratio,
        block_mode=body.block_mode,
        risk_rollout=_kernel_normalize_risk_rollout(body.risk_rollout),
        window_start_utc=start_dt.isoformat() if start_dt else None,
        window_end_utc=end_dt.isoformat() if end_dt else None,
        note=body.note,
        updated_by=current_user.sub,
    )
    policy = _kernel_policy_for_tenant(target_tenant)
    _remember_event(
        user_id=current_user.sub,
        trace_id=None,
        node="kernel.rollout.policy",
        event_type="updated",
        payload={"tenant_id": target_tenant, "policy": policy},
        level="warning",
    )
    return {
        "ok": True,
        "tenant_id": target_tenant,
        "storage": row,
        "policy": policy,
        "window_active": _kernel_window_active(policy),
    }


@app.post("/kernel/report/{trace_id}/rollback")
async def kernel_report_rollback(
    trace_id: str,
    body: KernelRollbackRequest,
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")

    report = (getattr(app.state, "kernel_reports", {}) or {}).get(trace_id)
    persisted = memory_get_kernel_report(
        tenant_id=current_user.tenant_id,
        user_id=effective_user_id,
        trace_id=trace_id,
    )
    if report is None and isinstance(persisted, dict):
        report = persisted.get("report") or {}
    if not isinstance(report, dict) or not report:
        raise HTTPException(status_code=404, detail="kernel report not found")

    stage = body.stage
    if stage == "preflight":
        guardian = report.get("guardian", {})
        verification = report.get("verification", {})
        confidence = report.get("confidence", {})
        source_credibility = report.get("source_credibility", {})
        memory_context = report.get("memory_context", {})
        hitl_required = str(guardian.get("decision", "review")) != "allow" or not bool(
            verification.get("accepted", False)
        )
    else:
        guardian = report.get("post_guardian") or report.get("guardian", {})
        verification = report.get("post_verification") or report.get("verification", {})
        confidence = (
            ((report.get("runtime") or {}).get("strategy_confidence_interval"))
            or report.get("confidence", {})
        )
        source_credibility = (
            ((report.get("runtime") or {}).get("source_credibility"))
            or report.get("source_credibility", {})
        )
        memory_context = (
            ((report.get("runtime") or {}).get("memory_context"))
            or report.get("memory_context", {})
        )
        hitl_required = bool((report.get("runtime") or {}).get("hitl_required", True))

    rollback_trace_id = f"{trace_id}:rollback:{stage}:{uuid.uuid4().hex[:8]}"
    replay_payload = {
        "trace_id": rollback_trace_id,
        "task_description": str(report.get("task_description") or "rollback replay"),
        "user_id": str(report.get("user_id") or effective_user_id),
        "tenant_id": str(report.get("tenant_id") or current_user.tenant_id),
        "competitor_handles": report.get("competitor_handles", []),
        "target_account_url": "",
        "analysis_mode": False,
        "edge_targets": [],
        "messages": [],
        "delivery_results": [],
        "source_credibility": source_credibility if isinstance(source_credibility, dict) else {},
        "memory_context": memory_context if isinstance(memory_context, dict) else {},
        "strategy_confidence": confidence if isinstance(confidence, dict) else {},
        "hitl_required": hitl_required,
        "hitl_reason": f"rollback_replay_{stage}",
    }
    rollback_report = {
        "trace_id": trace_id,
        "stage": stage,
        "guardian": guardian,
        "verification": verification,
        "confidence": confidence,
        "source_credibility": source_credibility,
        "memory_context": memory_context,
        "hitl_required": hitl_required,
        "dry_run": body.dry_run,
        "rollback_trace_id": rollback_trace_id,
    }
    _remember_event(
        user_id=effective_user_id,
        trace_id=trace_id,
        node="kernel.rollback",
        event_type="requested",
        payload=rollback_report,
        level="warning",
    )
    approval_id = str(body.approval_id or "").strip() or None

    if body.dry_run:
        record_meta = memory_record_kernel_rollback(
            tenant_id=current_user.tenant_id,
            user_id=effective_user_id,
            source_trace_id=trace_id,
            rollback_trace_id=rollback_trace_id,
            stage=stage,
            dry_run=True,
            status="preview",
            approval_id=None,
            detail=rollback_report,
        )
        return {
            "ok": True,
            "dry_run": True,
            "stage": stage,
            "rollback_trace_id": rollback_trace_id,
            "storage": record_meta,
            "rollback_report": rollback_report,
            "replay_payload": replay_payload,
        }

    if not approval_id:
        approval_id = f"krb_{uuid.uuid4().hex[:10]}"
        approval_payload = {
            "approval_id": approval_id,
            "type": "kernel_rollback_execute",
            "requested_at": datetime.now(timezone.utc).isoformat(),
            "scope": {
                "tenant_id": current_user.tenant_id,
                "user_id": effective_user_id,
                "source_trace_id": trace_id,
                "rollback_trace_id": rollback_trace_id,
                "stage": stage,
                "task_description": str(report.get("task_description") or "")[:220],
                "score": ((report.get("runtime") or {}).get("score")),
                "lead_count": len((report.get("leads") or [])),
            },
        }
        await _hitl_request_hook(approval_payload)
        record_meta = memory_record_kernel_rollback(
            tenant_id=current_user.tenant_id,
            user_id=effective_user_id,
            source_trace_id=trace_id,
            rollback_trace_id=rollback_trace_id,
            stage=stage,
            dry_run=False,
            status="pending_approval",
            approval_id=approval_id,
            detail={**rollback_report, "approval_payload": approval_payload},
        )
        return JSONResponse(
            status_code=202,
            content={
                "ok": True,
                "dry_run": False,
                "pending_approval": True,
                "approval_id": approval_id,
                "stage": stage,
                "rollback_trace_id": rollback_trace_id,
                "storage": record_meta,
                "rollback_report": rollback_report,
            },
        )

    approval_record = (getattr(app.state, "hitl_pending", {}) or {}).get(approval_id, {})
    approval_scope = approval_record.get("scope", {}) if isinstance(approval_record, dict) else {}
    if isinstance(approval_scope, dict):
        source_trace = str(approval_scope.get("source_trace_id") or "").strip()
        approval_stage = str(approval_scope.get("stage") or "").strip()
        if source_trace and source_trace != trace_id:
            raise HTTPException(status_code=409, detail="approval_id does not match source trace")
        if approval_stage and approval_stage != stage:
            raise HTTPException(status_code=409, detail="approval_id does not match rollback stage")

    hitl_status = await _read_hitl_status(approval_id)
    decision = str(hitl_status.get("decision") or "pending").strip().lower()
    if decision != "approved":
        status_tag = "approval_rejected" if decision == "rejected" else "pending_approval"
        record_meta = memory_record_kernel_rollback(
            tenant_id=current_user.tenant_id,
            user_id=effective_user_id,
            source_trace_id=trace_id,
            rollback_trace_id=rollback_trace_id,
            stage=stage,
            dry_run=False,
            status=status_tag,
            approval_id=approval_id,
            detail={**rollback_report, "approval_status": hitl_status},
        )
        if decision == "rejected":
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "rollback_approval_rejected",
                    "approval_id": approval_id,
                    "status": hitl_status,
                    "storage": record_meta,
                },
            )
        return JSONResponse(
            status_code=202,
            content={
                "ok": True,
                "dry_run": False,
                "pending_approval": True,
                "approval_id": approval_id,
                "stage": stage,
                "rollback_trace_id": rollback_trace_id,
                "approval_status": hitl_status,
                "storage": record_meta,
            },
        )

    config = _graph_config(
        f"{effective_user_id}_rollback_{stage}",
        run_type="kernel_report_rollback",
        user_id=effective_user_id,
        extra={"source_trace_id": trace_id, "rollback_trace_id": rollback_trace_id},
    )
    try:
        result = await _invoke_dynamic_graph(
            goal=str(report.get("task_description") or "rollback replay"),
            payload=replay_payload,
            config=config,
            industry_context={"tenant_id": current_user.tenant_id, "user_id": effective_user_id},
        )
    except Exception as exc:  # noqa: BLE001
        memory_record_kernel_rollback(
            tenant_id=current_user.tenant_id,
            user_id=effective_user_id,
            source_trace_id=trace_id,
            rollback_trace_id=rollback_trace_id,
            stage=stage,
            dry_run=False,
            status="executed_failed",
            approval_id=approval_id,
            detail={**rollback_report, "error": str(exc)},
        )
        raise
    record_meta = memory_record_kernel_rollback(
        tenant_id=current_user.tenant_id,
        user_id=effective_user_id,
        source_trace_id=trace_id,
        rollback_trace_id=rollback_trace_id,
        stage=stage,
        dry_run=False,
        status="executed_approved",
        approval_id=approval_id,
        detail={
            **rollback_report,
            "approval_status": hitl_status,
            "result_score": result.get("score", 0),
            "hitl_decision": result.get("hitl_decision"),
        },
    )
    _remember_event(
        user_id=effective_user_id,
        trace_id=trace_id,
        node="kernel.rollback",
        event_type="executed",
        payload={
            "stage": stage,
            "rollback_trace_id": rollback_trace_id,
            "score": result.get("score", 0),
            "hitl_decision": result.get("hitl_decision"),
        },
        level="warning",
    )
    return {
        "ok": True,
        "dry_run": False,
        "stage": stage,
        "rollback_trace_id": rollback_trace_id,
        "approval_id": approval_id,
        "storage": record_meta,
        "result": result,
    }


@app.get("/kernel/report/{trace_id}")
async def kernel_report(
    trace_id: str,
    user_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    report = (getattr(app.state, "kernel_reports", {}) or {}).get(trace_id)
    persisted = memory_get_kernel_report(
        tenant_id=current_user.tenant_id,
        user_id=effective_user_id,
        trace_id=trace_id,
    )
    if report is None and isinstance(persisted, dict):
        report = persisted.get("report") or {}
    trace = lossless_trace_snapshot(user_id=effective_user_id, trace_id=trace_id)
    replay = lossless_replay_trace(user_id=effective_user_id, trace_id=trace_id)
    approval_journal = _extract_approval_journal(replay)
    industry = industry_kb_trace_snapshot(
        tenant_id=current_user.tenant_id,
        trace_id=trace_id,
    )
    return {
        "ok": True,
        "trace_id": trace_id,
        "kernel_report": report or {},
        "kernel_report_persisted": persisted or {},
        "approval_journal": approval_journal,
        "industry_kb": industry,
        "trace": trace,
        "replay": replay,
    }


@app.get("/kernel/reports")
async def kernel_reports(
    user_id: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    current_user: UserClaims = Depends(_decode_user),
):
    effective_user_id = user_id or current_user.sub
    if effective_user_id != current_user.sub and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    rows = memory_list_kernel_reports(
        tenant_id=current_user.tenant_id,
        user_id=effective_user_id,
        limit=limit,
    )
    return {"ok": True, "count": len(rows), "reports": rows}


@app.get("/kernel/metrics/dashboard")
async def kernel_metrics_dashboard(
    tenant_id: str | None = Query(default=None),
    from_utc: str | None = Query(default=None, alias="from"),
    to_utc: str | None = Query(default=None, alias="to"),
    granularity: str = Query(default="day", pattern="^(hour|day)$"),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")

    from_dt = _parse_dt(from_utc)
    to_dt = _parse_dt(to_utc)
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from must be <= to")

    metrics = memory_kernel_metrics_dashboard(
        tenant_id=target_tenant,
        from_utc=from_dt.isoformat() if from_dt else None,
        to_utc=to_dt.isoformat() if to_dt else None,
        granularity=granularity,
    )
    return {"ok": True, **metrics}


@app.get("/kernel/alerts/evaluate")
async def kernel_alerts_evaluate(
    tenant_id: str | None = Query(default=None),
    from_utc: str | None = Query(default=None, alias="from"),
    to_utc: str | None = Query(default=None, alias="to"),
    granularity: str = Query(default="day", pattern="^(hour|day)$"),
    current_user: UserClaims = Depends(_decode_user),
):
    target_tenant = str(tenant_id or current_user.tenant_id).strip()
    if not target_tenant:
        raise HTTPException(status_code=400, detail="tenant_id is required")
    if target_tenant != current_user.tenant_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this tenant")

    from_dt = _parse_dt(from_utc)
    to_dt = _parse_dt(to_utc)
    if from_dt and to_dt and from_dt > to_dt:
        raise HTTPException(status_code=400, detail="from must be <= to")

    metrics = memory_kernel_metrics_dashboard(
        tenant_id=target_tenant,
        from_utc=from_dt.isoformat() if from_dt else None,
        to_utc=to_dt.isoformat() if to_dt else None,
        granularity=granularity,
    )
    alerts = _kernel_alert_signals(tenant_id=target_tenant, metrics=metrics)
    return {"ok": True, **alerts}


# ─────────────────────────────────────────────────────────────────
# Artifact Store API — 龙虾产出物查询接口
# 供 Dashboard 调用，查看每个任务每只龙虾产出了什么
# ─────────────────────────────────────────────────────────────────

from fastapi.responses import HTMLResponse, FileResponse
from artifact_store import get_artifact_store, ARTIFACT_TYPES


class ArtifactStatusUpdateRequest(BaseModel):
    status: str = Field(..., min_length=1, max_length=32)
    reviewer: str | None = Field(default=None, max_length=128)
    review_note: str | None = Field(default=None, max_length=1000)
    score: float | None = Field(default=None, ge=0, le=100)


@app.get("/api/v1/artifacts")
async def api_list_artifacts(
    run_id: str | None = Query(default=None, max_length=128),
    lobster: str | None = Query(default=None, max_length=64),
    artifact_type: str | None = Query(default=None, max_length=64),
    status: str | None = Query(default=None, max_length=32),
    limit: int = Query(default=100, ge=1, le=500),
    current_user: UserClaims = Depends(_decode_user),
):
    """查询产出物列表（Dashboard 主要调用接口）"""
    store = get_artifact_store()
    if run_id:
        artifacts = store.list_by_run(
            run_id=run_id,
            artifact_type=artifact_type,
            lobster=lobster,
            status=status,
            limit=limit,
        )
    elif lobster:
        artifacts = store.list_by_lobster(
            lobster=lobster,
            artifact_type=artifact_type,
            limit=limit,
        )
    else:
        artifacts = store.recent_artifacts(limit=limit)
        return {"ok": True, "count": len(artifacts), "artifacts": artifacts}
    return {
        "ok": True,
        "count": len(artifacts),
        "artifacts": [a.to_summary() for a in artifacts],
    }


@app.get("/api/v1/artifacts/recent")
async def api_recent_artifacts(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: UserClaims = Depends(_decode_user),
):
    """最近产出物（Dashboard 首页滚动）"""
    store = get_artifact_store()
    items = store.recent_artifacts(limit=limit)
    return {"ok": True, "count": len(items), "artifacts": items}


@app.get("/api/v1/artifacts/{artifact_id}")
async def api_get_artifact(
    artifact_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    """获取单条产出物详情（点击查看全文）"""
    store = get_artifact_store()
    artifact = store.get(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="artifact_not_found")
    return {"ok": True, "artifact": artifact.to_dict()}


@app.post("/api/v1/artifacts/classify")
async def api_classify_artifact_content(
    body: dict[str, Any],
    current_user: UserClaims = Depends(_decode_user),
):
    from artifact_classifier import get_artifact_classifier

    content = str(body.get("content") or "").strip()
    lobster_id = str(body.get("lobster_id") or "").strip()
    return {
        "ok": True,
        "artifacts": [block.to_dict() for block in get_artifact_classifier().classify(content, lobster_id)],
    }


@app.get("/api/v1/artifacts/{artifact_id}/render")
async def api_render_artifact(
    artifact_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    from artifact_classifier import get_artifact_classifier

    store = get_artifact_store()
    artifact = store.get(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="artifact_not_found")
    payload = artifact.to_dict()
    enriched = get_artifact_classifier().enrich_artifact_payload(payload)
    return {"ok": True, "artifact_id": artifact_id, "artifact": enriched}


@app.post("/api/v1/artifacts/{artifact_id}/status")
async def api_update_artifact_status(
    artifact_id: str,
    body: ArtifactStatusUpdateRequest,
    current_user: UserClaims = Depends(_decode_user),
):
    """更新产出物状态（批准/拒绝/发布）"""
    store = get_artifact_store()
    artifact = store.get(artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="artifact_not_found")
    valid_statuses = {"draft", "approved", "rejected", "published"}
    if body.status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"status must be one of {valid_statuses}")
    ok = store.update_status(
        artifact_id=artifact_id,
        status=body.status,
        reviewer=body.reviewer or current_user.sub,
        review_note=body.review_note or "",
        score=body.score,
    )
    _remember_event(
        user_id=current_user.sub,
        trace_id=artifact.run_id,
        node="artifact.status_update",
        event_type=body.status,
        payload={
            "artifact_id": artifact_id,
            "lobster": artifact.lobster,
            "artifact_type": artifact.artifact_type,
            "status": body.status,
            "reviewer": body.reviewer or current_user.sub,
        },
        level="info",
    )
    return {"ok": ok, "artifact_id": artifact_id, "status": body.status}


@app.get("/api/v1/artifacts/{artifact_id}/lineage")
async def api_artifact_lineage(
    artifact_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    """获取产出物上下游关系（溯源链路）"""
    store = get_artifact_store()
    lineage = store.get_lineage(artifact_id)
    return {"ok": True, "artifact_id": artifact_id, "lineage": lineage}


@app.get("/api/v1/runs/{run_id}/artifacts/summary")
async def api_run_artifacts_summary(
    run_id: str,
    current_user: UserClaims = Depends(_decode_user),
):
    """某个任务的产出物统计摘要"""
    store = get_artifact_store()
    summary = store.summary_by_run(run_id)
    return {"ok": True, "summary": summary}


@app.post("/api/v1/artifacts")
async def api_save_artifact(
    body: dict[str, Any],
    current_user: UserClaims = Depends(_decode_user),
):
    """手动保存产出物（供龙虾调用或测试）"""
    store = get_artifact_store()
    run_id = str(body.get("run_id") or "").strip()
    lobster = str(body.get("lobster") or "").strip()
    artifact_type = str(body.get("artifact_type") or "other").strip()
    if not run_id or not lobster:
        raise HTTPException(status_code=400, detail="run_id and lobster are required")
    if artifact_type not in ARTIFACT_TYPES:
        artifact_type = "other"
    artifact_id = store.save(
        run_id=run_id,
        lobster=lobster,
        artifact_type=artifact_type,
        content=str(body.get("content") or ""),
        content_url=str(body.get("content_url") or ""),
        step_index=body.get("step_index"),
        version=int(body.get("version") or 1),
        status=str(body.get("status") or "draft"),
        meta=body.get("meta") if isinstance(body.get("meta"), dict) else {},
        triggered_by=body.get("triggered_by"),
    )
    return {"ok": True, "artifact_id": artifact_id}


# ─────────────────────────────────────────────────────────────────
# Dragon Dashboard — 可视化指挥中心入口
# 访问 /dashboard 即可看到全链路可视化界面
# ─────────────────────────────────────────────────────────────────

@app.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
async def dragon_dashboard():
    """
    Dragon Senate 指挥中心 Dashboard。
    展示：10只龙虾状态 / 任务进度 / 产出物列表 / 实时事件流。
    无需登录即可预览（演示模式），连接 API 后显示真实数据。
    """
    dashboard_path = Path(__file__).resolve().parent / "dragon_dashboard.html"
    if dashboard_path.exists():
        return HTMLResponse(content=dashboard_path.read_text(encoding="utf-8"))
    return HTMLResponse(content="<h1>Dashboard file not found</h1><p>dragon_dashboard.html missing</p>", status_code=404)


@app.get("/api/v1/lobsters/status")
async def api_lobsters_status(
    tenant_id: str | None = Query(default=None),
    current_user: UserClaims = Depends(_decode_user),
):
    """
    返回所有龙虾当前状态（Dashboard 左栏调用）。
    从 lobster_mailbox 心跳表读取实时状态。
    """
    from lobster_mailbox import get_lobster_mailbox
    mailbox = get_lobster_mailbox()
    active = mailbox.get_active_lobsters()
    active_map = {row["lobster_name"]: row for row in active}

    lobster_ids = [
        "commander", "strategist", "inkwriter", "radar",
        "visualizer", "dispatcher", "echoer", "catcher", "abacus", "followup"
    ]
    lobster_names = {
        "commander": "陈", "strategist": "苏思", "inkwriter": "墨小雅",
        "radar": "林探", "visualizer": "影子", "dispatcher": "老将",
        "echoer": "阿声", "catcher": "铁钩", "abacus": "算无遗策", "followup": "小锤",
    }

    lobsters = []
    for lid in lobster_ids:
        row = active_map.get(lid, {})
        status = "idle"
        if row:
            raw_status = str(row.get("status") or "idle")
            status = raw_status if raw_status in {"active", "idle", "working", "waiting", "done", "error"} else "idle"
            if raw_status == "active":
                status = "working"
        lobsters.append({
            "name": lid,
            "display_name": lobster_names.get(lid, lid),
            "status": status,
            "current_task": None,
            "last_seen": row.get("last_seen_ts"),
        })

    return {"ok": True, "count": len(lobsters), "lobsters": lobsters}


def _env_bool(name: str, default: bool = False) -> bool:
    return _bool_env(name, default)

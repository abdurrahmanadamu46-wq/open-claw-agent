"""
LobsterMemoryEngine — 弹性记忆模块核心
使命：让边缘设备拥有「连贯的灵魂」，按 node_id / persona_id 硬隔离，避免海量数据撑爆存储。

技术栈：Qdrant（Payload 级强过滤 + Rust 底层）+ BGE-M3 本地 Embedding + 时间与奖励动态衰减重排
"""
import time
import math
import uuid
from typing import List, Dict, Any, Optional

from qdrant_client import QdrantClient
from qdrant_client.http import models
from sentence_transformers import SentenceTransformer
from bm25_sparse_embedder import BM25SparseEmbedder


# BGE-M3 向量维度（根据模型实际输出，bge-m3 为 1024）
BGE_M3_DIM = 1024


class LobsterMemoryEngine:
    def __init__(
        self,
        qdrant_host: str = "localhost",
        qdrant_port: int = 6333,
        collection_name: str = "lobster_episodic_memory",
    ):
        self.client = QdrantClient(host=qdrant_host, port=qdrant_port)
        self.collection_name = collection_name
        self.embedder = SentenceTransformer("BAAI/bge-m3")
        self.sparse_embedder = BM25SparseEmbedder()
        self._ensure_collection_exists()

    def _ensure_collection_exists(self) -> None:
        """确保记忆集合存在，并为 node_id / persona_id 建立 Payload 索引以实现极速过滤"""
        collections = self.client.get_collections().collections
        if not any(c.name == self.collection_name for c in collections):
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=models.VectorParams(
                    size=BGE_M3_DIM,
                    distance=models.Distance.COSINE,
                ),
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="node_id",
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="persona_id",
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="tenant_id",
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="lobster_name",
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="memory_type",
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
        else:
            # Best-effort backfill for existing collections.
            for field_name in ("tenant_id", "lobster_name", "memory_type", "node_id", "persona_id"):
                try:
                    self.client.create_payload_index(
                        collection_name=self.collection_name,
                        field_name=field_name,
                        field_schema=models.PayloadSchemaType.KEYWORD,
                    )
                except Exception:
                    pass

    def store_experience(
        self,
        node_id: str,
        intent: str,
        context_data: Dict[str, Any],
        reward: float,
        persona_id: Optional[str] = None,
        tenant_id: str = "tenant_main",
        lobster_name: Optional[str] = None,
        memory_type: str = "episodic",
    ) -> str:
        """
        记忆写入：将边缘节点的一次完整交互记录下来。
        返回写入点的 id。
        """
        memory_text = (
            f"Action Intent: {intent} | Context: {str(context_data)} | Outcome Reward: {reward}"
        )
        vector = self.embedder.encode(memory_text).tolist()

        payload = {
            "node_id": node_id,
            "tenant_id": tenant_id,
            "lobster_name": lobster_name or "",
            "memory_type": memory_type,
            "intent": intent,
            "context_data": context_data,
            "reward": reward,
            "timestamp": int(time.time()),
            "memory_text": memory_text,
        }
        if persona_id is not None:
            payload["persona_id"] = persona_id

        point_id = str(uuid.uuid4())
        self.client.upsert(
            collection_name=self.collection_name,
            points=[
                models.PointStruct(
                    id=point_id,
                    vector=vector,
                    payload=payload,
                )
            ],
        )
        return point_id

    def retrieve_adaptive_memory(
        self,
        node_id: str,
        current_task: str,
        top_k: int = 5,
        persona_id: Optional[str] = None,
        initial_recall_multiplier: int = 3,
        tenant_id: Optional[str] = None,
        lobster_name: Optional[str] = None,
        memory_type: Optional[str] = None,
        days: Optional[int] = None,
        use_hybrid: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        记忆检索与认知衰减：只召回该设备（及可选 persona）的记忆，
        按相似度召回 initial_recall_multiplier * top_k 条，再融合时间与重要度重排后取 top_k。
        """
        query_vector = self.embedder.encode(current_task).tolist()
        payload_filter = self._build_filter(
            node_id=node_id,
            persona_id=persona_id,
            tenant_id=tenant_id,
            lobster_name=lobster_name,
            memory_type=memory_type,
            days=days,
        )

        raw_results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            query_filter=payload_filter,
            limit=max(top_k * initial_recall_multiplier, top_k),
        )

        if not use_hybrid:
            ranked_memories = self._apply_decay_and_rerank(raw_results)
            return ranked_memories[:top_k]

        sparse_candidates = self._fetch_sparse_candidates(payload_filter, limit=max(120, top_k * 20))
        hybrid_ranked = self._apply_hybrid_fusion(
            query=current_task,
            dense_results=raw_results,
            sparse_candidates=sparse_candidates,
        )
        return hybrid_ranked[:top_k]

    def _build_filter(
        self,
        *,
        node_id: str,
        persona_id: Optional[str],
        tenant_id: Optional[str],
        lobster_name: Optional[str],
        memory_type: Optional[str],
        days: Optional[int],
    ) -> models.Filter:
        must_conditions = [models.FieldCondition(key="node_id", match=models.MatchValue(value=node_id))]
        if persona_id is not None:
            must_conditions.append(
                models.FieldCondition(key="persona_id", match=models.MatchValue(value=persona_id))
            )
        if tenant_id:
            must_conditions.append(
                models.FieldCondition(key="tenant_id", match=models.MatchValue(value=tenant_id))
            )
        if lobster_name:
            must_conditions.append(
                models.FieldCondition(key="lobster_name", match=models.MatchValue(value=lobster_name))
            )
        if memory_type:
            must_conditions.append(
                models.FieldCondition(key="memory_type", match=models.MatchValue(value=memory_type))
            )
        if days:
            cutoff = int(time.time()) - max(1, int(days)) * 86400
            must_conditions.append(
                models.FieldCondition(key="timestamp", range=models.Range(gte=cutoff))
            )
        return models.Filter(must=must_conditions)

    def _fetch_sparse_candidates(self, payload_filter: models.Filter, limit: int = 120) -> list[models.Record]:
        response = self.client.scroll(
            collection_name=self.collection_name,
            scroll_filter=payload_filter,
            limit=max(1, min(int(limit), 500)),
            with_payload=True,
            with_vectors=False,
        )
        points = response[0] if isinstance(response, tuple) else response
        return list(points or [])

    def _apply_hybrid_fusion(
        self,
        *,
        query: str,
        dense_results: list[Any],
        sparse_candidates: list[Any],
        top_k: int = 10,
    ) -> list[dict[str, Any]]:
        dense_ranked = self._apply_decay_and_rerank(dense_results)
        dense_rank_map = {
            str(item["memory_details"].get("_point_id") or item["memory_details"].get("point_id") or item["memory_details"].get("memory_id") or item["memory_details"].get("id") or item["memory_details"].get("uuid") or idx): idx + 1
            for idx, item in enumerate(dense_ranked)
        }

        sparse_texts = []
        sparse_meta_by_id: dict[str, dict[str, Any]] = {}
        for idx, candidate in enumerate(sparse_candidates):
            payload = dict(candidate.payload or {})
            candidate_id = str(getattr(candidate, "id", None) or payload.get("id") or f"sparse_{idx}")
            payload["_point_id"] = candidate_id
            sparse_texts.append(
                f"{payload.get('intent', '')} {json.dumps(payload.get('context_data', {}), ensure_ascii=False)} {payload.get('memory_text', '')}"
            )
            sparse_meta_by_id[candidate_id] = payload

        sparse_scores = self.sparse_embedder.score_documents(query, sparse_texts)
        sparse_ranked_ids = [
            candidate_id
            for candidate_id, score in sorted(
                zip(sparse_meta_by_id.keys(), sparse_scores),
                key=lambda item: item[1],
                reverse=True,
            )
            if score > 0
        ]
        sparse_rank_map = {candidate_id: index + 1 for index, candidate_id in enumerate(sparse_ranked_ids)}

        combined_ids = set(dense_rank_map) | set(sparse_rank_map)
        fused: list[dict[str, Any]] = []
        for candidate_id in combined_ids:
            dense_rank = dense_rank_map.get(candidate_id)
            sparse_rank = sparse_rank_map.get(candidate_id)
            rrf_score = 0.0
            if dense_rank is not None:
                rrf_score += 1.0 / (60 + dense_rank)
            if sparse_rank is not None:
                rrf_score += 1.0 / (60 + sparse_rank)

            payload = sparse_meta_by_id.get(candidate_id)
            if payload is None:
                dense_payload = next(
                    (item["memory_details"] for item in dense_ranked if str(item["memory_details"].get("_point_id", "")) == candidate_id),
                    None,
                )
                payload = dense_payload or {}
            fused.append(
                {
                    "final_score": rrf_score,
                    "memory_details": payload,
                    "dense_rank": dense_rank,
                    "sparse_rank": sparse_rank,
                }
            )

        fused.sort(key=lambda item: item["final_score"], reverse=True)
        return fused[:top_k]

    def _apply_decay_and_rerank(self, raw_results: List[Any]) -> List[Dict[str, Any]]:
        """
        综合打分：相似度 * 时间衰减 + 奖励权重。
        既保留近期记忆，也保留历史上高 reward 的经验。
        """
        current_time = int(time.time())
        decayed_results = []

        for result in raw_results:
            base_similarity = result.score
            payload = dict(result.payload or {})
            payload["_point_id"] = str(getattr(result, "id", payload.get("id") or ""))

            days_passed = (current_time - payload["timestamp"]) / (24 * 3600)
            time_penalty = math.exp(-0.1 * days_passed)
            importance_boost = payload.get("reward", 0.5)

            final_score = (base_similarity * time_penalty) + (0.3 * importance_boost)

            decayed_results.append({
                "final_score": final_score,
                "memory_details": payload,
            })

        decayed_results.sort(key=lambda x: x["final_score"], reverse=True)
        return decayed_results


# ---------- 使用示例（供测试参考） ----------
if __name__ == "__main__":
    engine = LobsterMemoryEngine()

    engine.store_experience(
        node_id="edge_device_10086",
        intent="generate_and_post_video",
        context_data={
            "format": "10秒爆款短视频 (5个分镜)",
            "clips_needed": 5,
            "audience_type": "视觉冲动型",
            "engagement_rate": "high",
        },
        reward=0.95,
    )

    current_task = "准备为新产品制作一个极速带货视频，需要短平快"
    active_memories = engine.retrieve_adaptive_memory(
        node_id="edge_device_10086",
        current_task=current_task,
        top_k=2,
    )

    print("\n[检索到的激活记忆]:")
    for mem in active_memories:
        print(f"得分: {mem['final_score']:.3f} | 上下文: {mem['memory_details']['context_data']}")

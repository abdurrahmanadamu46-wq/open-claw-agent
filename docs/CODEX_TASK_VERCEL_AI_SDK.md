# CODEX TASK: Vercel AI SDK 前端流式对话体验
**任务ID**: CODEX-VERCELAI-P2-001  
**优先级**: 🟡 P2（前端：龙虾对话从"等待→一次性返回"→"逐字流式输出"）  
**依赖文件**: `dragon-senate-saas-v2/api_lobster_realtime.py`, 前端 React 组件  
**参考项目**: Vercel AI SDK（https://github.com/vercel/ai）  
**预计工期**: 1.5天

---

## 一、当前痛点

**现状**：用户与龙虾对话时，请求发出后"白屏等待"3-15秒，然后整段文字一次性出现。

**Vercel AI SDK 解决**：
- `useChat` Hook：一行代码实现流式对话 UI
- 自动处理 SSE 流、消息列表管理、加载状态
- 支持工具调用 UI（显示龙虾使用了哪些工具）
- `useCompletion`：流式文本生成（文案撰写场景）

---

## 二、后端流式 API

```python
# dragon-senate-saas-v2/api_lobster_stream.py（新建）
"""
龙虾流式对话 API
兼容 Vercel AI SDK 的 StreamingTextResponse 协议
"""

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from anthropic import Anthropic

stream_router = APIRouter()


@stream_router.post("/api/chat")
async def chat_stream(request: dict):
    """
    流式对话（Vercel AI SDK 兼容格式）
    
    Vercel AI SDK 的 useChat 默认发送：
    {
        "messages": [
            {"role": "user", "content": "帮我写一篇小红书文案"},
            ...
        ]
    }
    
    返回 SSE 流：data: {"content": "好的"}\n\n
    """
    messages = request.get("messages", [])
    lobster_id = request.get("lobster_id", "inkwriter")
    
    client = Anthropic()
    
    # 注入龙虾 system prompt
    system = get_lobster_system_prompt(lobster_id)
    
    async def generate():
        with client.messages.stream(
            model="claude-sonnet-4-5",
            max_tokens=4096,
            system=system,
            messages=messages,
        ) as stream:
            for text in stream.text_stream:
                # Vercel AI SDK 期望的 SSE 格式
                yield f"0:{json.dumps(text)}\n"
        
        # 流结束标记
        yield f"e:{json.dumps({'finishReason': 'stop'})}\n"
    
    return StreamingResponse(
        generate(),
        media_type="text/plain; charset=utf-8",
        headers={
            "X-Vercel-AI-Data-Stream": "v1",
        },
    )


def get_lobster_system_prompt(lobster_id: str) -> str:
    """获取龙虾系统提示词"""
    from .prompt_registry import PromptRegistry
    registry = PromptRegistry()
    return registry.get_system_prompt(lobster_id)
```

---

## 三、前端 React 集成

```tsx
// src/chat/LobsterChat.tsx
"use client";

import { useChat } from "ai/react";
import { useState } from "react";

const LOBSTER_AVATARS = {
  inkwriter: { name: "墨小鸦", emoji: "🦞✍️" },
  strategist: { name: "苏丝", emoji: "🦞🧠" },
  echoer: { name: "阿声", emoji: "🦞📢" },
  commander: { name: "陈总", emoji: "🦞👑" },
};

export function LobsterChat() {
  const [activeLobster, setActiveLobster] = useState("inkwriter");
  
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: "/api/chat",
    body: {
      lobster_id: activeLobster,
    },
  });

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto">
      {/* 龙虾选择栏 */}
      <div className="flex gap-2 p-4 border-b">
        {Object.entries(LOBSTER_AVATARS).map(([id, info]) => (
          <button
            key={id}
            onClick={() => setActiveLobster(id)}
            className={`px-3 py-1 rounded-full text-sm ${
              activeLobster === id
                ? "bg-red-500 text-white"
                : "bg-gray-100 text-gray-700"
            }`}
          >
            {info.emoji} {info.name}
          </button>
        ))}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                m.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-900"
              }`}
            >
              {m.role === "assistant" && (
                <span className="text-xs text-gray-500 block mb-1">
                  {LOBSTER_AVATARS[activeLobster]?.emoji}{" "}
                  {LOBSTER_AVATARS[activeLobster]?.name}
                </span>
              )}
              <p className="whitespace-pre-wrap">{m.content}</p>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-2 rounded-2xl">
              <span className="animate-pulse">
                {LOBSTER_AVATARS[activeLobster]?.emoji} 思考中...
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 输入框 */}
      <form onSubmit={handleSubmit} className="p-4 border-t flex gap-2">
        <input
          value={input}
          onChange={handleInputChange}
          placeholder={`和${LOBSTER_AVATARS[activeLobster]?.name}对话...`}
          className="flex-1 px-4 py-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="px-6 py-2 bg-red-500 text-white rounded-full disabled:opacity-50"
        >
          发送
        </button>
      </form>
    </div>
  );
}
```

---

## 四、文案生成流式（useCompletion）

```tsx
// src/tools/CopywritingStream.tsx
"use client";

import { useCompletion } from "ai/react";

export function CopywritingStream() {
  const { completion, input, handleInputChange, handleSubmit, isLoading } =
    useCompletion({
      api: "/api/generate-copy",
      body: { lobster_id: "inkwriter", platform: "xiaohongshu" },
    });

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h2 className="text-xl font-bold mb-4">🦞✍️ 墨小鸦文案生成器</h2>
      
      <form onSubmit={handleSubmit} className="mb-6">
        <textarea
          value={input}
          onChange={handleInputChange}
          placeholder="描述你的产品/服务..."
          className="w-full p-4 border rounded-lg h-32"
        />
        <button
          type="submit"
          disabled={isLoading}
          className="mt-2 px-6 py-2 bg-red-500 text-white rounded-lg"
        >
          {isLoading ? "✍️ 撰写中..." : "生成文案"}
        </button>
      </form>
      
      {completion && (
        <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
          <h3 className="font-bold mb-2">📝 生成结果</h3>
          <p className="whitespace-pre-wrap">{completion}</p>
        </div>
      )}
    </div>
  );
}
```

---

## 五、验收标准

- [ ] 后端 `/api/chat` 返回 SSE 流（Vercel AI SDK v1 格式）
- [ ] `useChat` 实现逐字流式显示（不再白屏等待）
- [ ] 龙虾选择切换正确（不同龙虾不同 system prompt）
- [ ] `useCompletion` 文案生成流式输出
- [ ] 移动端响应式布局
- [ ] 加载状态动画："🦞 思考中..." 
- [ ] 与 `llm_call_logger.py` 集成：流式请求也有日志

/**
 * Real external AI adapters.
 * No mock fallback is allowed in this layer.
 */

export interface StoryboardShot {
  order: number;
  duration_sec: number;
  scene_desc: string;
  voice_over?: string;
}

export interface StoryToStoryboardResult {
  shots: StoryboardShot[];
  provider: string;
}

export interface ImageGenResult {
  url: string;
  provider: string;
}

export interface VideoGenResult {
  url: string;
  provider: string;
}

function requiredEnv(name: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export async function storyToStoryboard(
  story: string,
  options?: { clips?: number },
): Promise<StoryToStoryboardResult> {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const model = String(process.env.OPENAI_STORY_MODEL ?? "gpt-4o-mini").trim();
  const clips = Math.max(1, Number(options?.clips ?? 5));

  const prompt =
    `将下面内容拆成 ${clips} 个分镜，返回严格 JSON：` +
    `{"shots":[{"order":1,"duration_sec":2,"scene_desc":"...","voice_over":"..."}]}\n\n` +
    `内容：\n${story}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`storyToStoryboard upstream failed: ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data?.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as { shots?: StoryboardShot[] };

  if (!Array.isArray(parsed.shots) || parsed.shots.length === 0) {
    throw new Error("storyToStoryboard invalid response: shots");
  }

  return { provider: "openai", shots: parsed.shots };
}

export async function generateImage(prompt: string): Promise<ImageGenResult> {
  const apiKey = requiredEnv("OPENAI_API_KEY");
  const model = String(process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1").trim();

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1024x1024",
      quality: "high",
    }),
  });

  if (!response.ok) {
    throw new Error(`generateImage upstream failed: ${response.status}`);
  }

  const data = (await response.json()) as { data?: Array<{ url?: string }> };
  const url = String(data?.data?.[0]?.url ?? "").trim();
  if (!url) {
    throw new Error("generateImage invalid response: url");
  }

  return { provider: "openai", url };
}

export async function generateVideo(storyboardShots: StoryboardShot[]): Promise<VideoGenResult> {
  const endpoint = requiredEnv("VIDEO_GEN_ENDPOINT");
  const apiKey = String(process.env.VIDEO_GEN_API_KEY ?? "").trim();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({ storyboard_shots: storyboardShots }),
  });

  if (!response.ok) {
    throw new Error(`generateVideo upstream failed: ${response.status}`);
  }

  const data = (await response.json()) as { url?: string; provider?: string };
  const url = String(data?.url ?? "").trim();
  if (!url) {
    throw new Error("generateVideo invalid response: url");
  }

  return {
    provider: String(data?.provider ?? "video_provider").trim() || "video_provider",
    url,
  };
}

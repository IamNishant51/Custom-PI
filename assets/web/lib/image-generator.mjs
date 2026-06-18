import { vaultGet } from "../services/vault.mjs";

export async function generateImageOpenAI(prompt, size, returnFormat) {
  const apiKey = vaultGet("OPENAI_API_KEY");
  if (!apiKey) return { error: "OPENAI_API_KEY not found in vault" };
  const resp = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "dall-e-3", prompt, n: 1, size: size || "1024x1024", response_format: returnFormat === "url" ? "url" : "b64_json" }),
  });
  const data = await resp.json();
  if (data.error) return { error: data.error.message };
  const img = data.data[0];
  return { image: returnFormat === "url" ? img.url : img.b64_json, format: returnFormat || "base64", provider: "openai" };
}

export async function generateImageGemini(prompt) {
  const apiKey = vaultGet("GEMINI_API_KEY");
  if (!apiKey) return { error: "GEMINI_API_KEY not found in vault" };
  const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["Text", "Image"] } }),
  });
  const data = await resp.json();
  if (data.error) return { error: data.error.message };
  for (const part of (data.candidates?.[0]?.content?.parts || [])) {
    if (part.inlineData) return { image: part.inlineData.data, format: "base64", mimeType: part.inlineData.mimeType, provider: "gemini" };
  }
  return { error: "No image generated", text: data.candidates?.[0]?.content?.parts?.[0]?.text || "Unknown" };
}

export async function generateImageGrok(prompt, returnFormat) {
  const apiKey = vaultGet("XAI_API_KEY");
  if (!apiKey) return { error: "XAI_API_KEY not found in vault" };
  const resp = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "grok-2-image", prompt, n: 1, response_format: returnFormat === "url" ? "url" : "b64_json" }),
  });
  const data = await resp.json();
  if (data.error) return { error: data.error.message };
  const img = data.data[0];
  return { image: returnFormat === "url" ? img.url : img.b64_json, format: returnFormat || "base64", provider: "grok" };
}

export async function generateImageDesignAPI(prompt, size, model) {
  const apiKey = vaultGet("DESIGN_API_KEY");
  if (!apiKey) return { error: "DESIGN_API_KEY not found in vault. Get one at https://designapi.ink" };
  const selectedModel = model || "flux-pro";
  const resp = await fetch("https://api.designapi.ink/v1/images/generations", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: selectedModel, prompt, n: 1, size: size || "1024x1024", response_format: "url" }),
  });
  const data = await resp.json();
  if (data.error) return { error: typeof data.error === "string" ? data.error : data.error.message || JSON.stringify(data.error) };
  const img = data.data[0];
  return { image: img.url, format: "url", provider: `designapi/${selectedModel}`, mimeType: "image/png" };
}

export async function generateImagePollinations(prompt, model, seed, width, height) {
  const selectedModel = model || "flux";
  const usedSeed = seed ?? Math.floor(Math.random() * 99999);
  const w = width || 1024;
  const h = height || 1024;
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=${encodeURIComponent(selectedModel)}&seed=${usedSeed}&width=${w}&height=${h}&nologo=true`;
  const resp = await fetch(url);
  if (!resp.ok) return { error: `Pollinations.ai error: ${resp.status} ${resp.statusText}` };
  const buf = Buffer.from(await resp.arrayBuffer());
  const mime = resp.headers.get("content-type") || "image/png";
  return { image: buf.toString("base64"), format: "base64", mimeType: mime, provider: `pollinations/${selectedModel}`, seed: usedSeed };
}

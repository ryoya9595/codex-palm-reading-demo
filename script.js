// 手相占い診断（OpenAI Vision・自分のAPIキー使用）
const LS_KEY = "codex-palm-openai-key";
const $ = (id) => document.getElementById(id);

const keyStatus = $("keyStatus");
const settingsModal = $("settingsModal");
const apiKeyInput = $("apiKey");
const fileInput = $("fileInput");
const dropInner = $("dropInner");
const preview = $("preview");
const retakeButton = $("retakeButton");
const diagnoseButton = $("diagnoseButton");
const statusEl = $("status");
const resultCard = $("resultCard");

let imageDataUrl = "";
let lastReadingContext = "";

function setLine(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  el.className = "status-line" + (kind ? " " + kind : "");
}

function getKey() {
  return (localStorage.getItem(LS_KEY) || "").trim();
}
function refreshKeyStatus() {
  if (!keyStatus) return;
  keyStatus.textContent = getKey() ? "APIキー: 設定済み ✓" : "APIキー: 未設定";
  keyStatus.classList.toggle("set", !!getKey());
}
function openSettings() {
  apiKeyInput.value = getKey();
  settingsModal.classList.remove("is-hidden");
}
function closeSettings() {
  settingsModal.classList.add("is-hidden");
}
function setStatus(text, kind) {
  statusEl.textContent = text || "";
  statusEl.className = "status-line" + (kind ? " " + kind : "");
}
function flashButton(btn, text) {
  if (!btn) return;
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  btn.textContent = text;
  btn.classList.add("flashed");
  setTimeout(() => {
    btn.textContent = btn.dataset.label;
    btn.classList.remove("flashed");
  }, 1500);
}

// 画像を縮小して dataURL に
function fileToDataUrl(file, maxSize = 1024) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function onFile(file) {
  if (!file) return;
  try {
    imageDataUrl = await fileToDataUrl(file);
    preview.src = imageDataUrl;
    preview.classList.remove("is-hidden");
    dropInner.classList.add("is-hidden");
    retakeButton.classList.remove("is-hidden");
    setStatus("");
  } catch {
    setStatus("画像を読み込めませんでした", "err");
  }
}

const STARS = (n) => "★★★★★☆☆☆☆☆".slice(5 - Math.max(0, Math.min(5, n)), 10 - Math.max(0, Math.min(5, n)));

async function diagnose() {
  const key = getKey();
  if (!key) {
    setStatus("先に設定からAPIキーを登録してください", "err");
    openSettings();
    return;
  }
  if (!imageDataUrl) {
    setStatus("先に手のひらの写真を選んでください", "err");
    return;
  }
  const ruleBook = typeof PALM_KNOWLEDGE !== "undefined" ? PALM_KNOWLEDGE : "";
  const sys =
    "あなたは経験豊富な手相診断士です。まず『この画像に実際に写っている』手のひらをよく観察し、主要な線（生命線・知能線・感情線・運命線・太陽線・結婚線・財運線）と手の形・丘を、粗いカテゴリ（例：長い/短い、濃い/薄い、まっすぐ/カーブ、あり/なし、発達/平坦）で判定します。" +
    "重要：必ず画像から読み取った特徴だけを使うこと。テンプレート的な一般回答や、毎回同じ決め打ちの内容を返すことは禁止。線がはっきり見えない場合は推測せず ok:false を返す。" +
    "そのうえで、下記の【手相ルールブック】に厳密に従って意味づけし、判定した特徴だけを根拠に診断を導きます。ルールにない解釈で大きく飛躍させず、同じ特徴なら同じ診断・違う特徴なら違う診断になるようにしてください。\n\n" +
    ruleBook;
  const user =
    "この手のひらを手相診断してください。出力はJSONのみ：\n" +
    '{"ok":true,"features":[{"name":"生命線","value":"長くはっきり"}],' +
    '"reading":"あなたの手相全体を読み解く、たっぷり長い総合コメント。8〜14文・2〜3段落（段落は\\nで区切る）。観察した特徴どうしを結びつけて、人柄・強み・今の流れ・これからのヒントまで、物語のように具体的に、前向きな語り口で。",' +
    '"fortunes":[{"name":"総合運","stars":4,"text":"..."},{"name":"恋愛運","stars":3,"text":"..."},{"name":"仕事運","stars":5,"text":"..."},{"name":"金運","stars":3,"text":"..."},{"name":"健康運","stars":4,"text":"..."}],' +
    '"summary":"総評（3〜4行）","lucky":{"color":"ラッキーカラー","item":"ラッキーアイテム","action":"今日の開運アクション"},' +
    '"details":[{"name":"総合運","basis":"観察した特徴 → どのルールに当てはまるか → だからこの評価、という根拠を1〜2文で"},{"name":"恋愛運","basis":"..."},{"name":"仕事運","basis":"..."},{"name":"金運","basis":"..."},{"name":"健康運","basis":"..."}],' +
    '"suggestions":["この手相の人が次に気になりそうな深掘り質問を4つ。短く。例：金運をもっと詳しく／結婚の時期は？／向いてる仕事は？／今年の運勢は？"]}\n' +
    "featuresは4〜6個。readingはたっぷり長く。fortunesとdetailsは必ずこの5項目・starsは1〜5の整数。suggestionsは4つ・この手相に合わせた具体的な質問文。detailsは各運勢の判定根拠（観察した特徴とルールの対応）を明確に。手のひらが判別できなければ {\"ok\":false,\"message\":\"手のひらがはっきり写っていません。明るい場所で手のひら全体を撮り直してください。\"} を返す。";

  setStatus("手相を読み取り中…（10〜20秒ほど）", "loading");
  diagnoseButton.disabled = true;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0,
        seed: 7,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              { type: "text", text: user },
              { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error("OpenAIエラー (" + res.status + "): " + t.slice(0, 280));
    }
    const data = await res.json();
    const out = JSON.parse(data.choices?.[0]?.message?.content || "{}");
    if (out.ok === false) {
      setStatus(out.message || "手のひらをうまく読み取れませんでした。撮り直してください。", "err");
      return;
    }
    renderResult(out);
    setStatus("診断完了！", "ok");
  } catch (e) {
    setStatus(e.message, "err");
  } finally {
    diagnoseButton.disabled = false;
  }
}

function renderResult(out) {
  // features
  const featuresEl = $("features");
  featuresEl.innerHTML = "";
  (out.features || []).forEach((f) => {
    const chip = document.createElement("div");
    chip.className = "feature-chip";
    const n = document.createElement("span");
    n.className = "feature-name";
    n.textContent = f.name || "";
    const v = document.createElement("span");
    v.className = "feature-value";
    v.textContent = f.value || "";
    chip.append(n, v);
    featuresEl.appendChild(chip);
  });

  // reading（長い総合コメント）
  const readingEl = $("reading");
  readingEl.innerHTML = "";
  String(out.reading || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((para) => {
      const p = document.createElement("p");
      p.textContent = para;
      readingEl.appendChild(p);
    });

  // fortunes
  const fortunesEl = $("fortunes");
  fortunesEl.innerHTML = "";
  (out.fortunes || []).forEach((fo) => {
    const row = document.createElement("div");
    row.className = "fortune";
    const head = document.createElement("div");
    head.className = "fortune-head";
    const name = document.createElement("strong");
    name.textContent = fo.name || "";
    const stars = document.createElement("span");
    stars.className = "stars";
    stars.textContent = STARS(Number(fo.stars) || 0);
    head.append(name, stars);
    const text = document.createElement("p");
    text.textContent = fo.text || "";
    row.append(head, text);
    fortunesEl.appendChild(row);
  });

  // summary
  const summaryEl = $("summary");
  summaryEl.innerHTML = "";
  const st = document.createElement("strong");
  st.textContent = "総評";
  const sp = document.createElement("p");
  sp.textContent = out.summary || "";
  summaryEl.append(st, sp);

  // lucky
  const luckyEl = $("lucky");
  luckyEl.innerHTML = "";
  const l = out.lucky || {};
  [
    ["ラッキーカラー", l.color],
    ["ラッキーアイテム", l.item],
    ["開運アクション", l.action],
  ].forEach(([label, val]) => {
    if (!val) return;
    const box = document.createElement("div");
    box.className = "lucky-box";
    const lb = document.createElement("span");
    lb.className = "lucky-label";
    lb.textContent = label;
    const vv = document.createElement("strong");
    vv.textContent = val;
    box.append(lb, vv);
    luckyEl.appendChild(box);
  });

  // details（根拠）— 初期は隠す
  const detailsEl = $("details");
  detailsEl.innerHTML = "";
  (out.details || []).forEach((d) => {
    const row = document.createElement("div");
    row.className = "detail-row";
    const name = document.createElement("strong");
    name.textContent = d.name || "";
    const basis = document.createElement("p");
    basis.textContent = d.basis || "";
    row.append(name, basis);
    detailsEl.appendChild(row);
  });
  detailsEl.classList.add("is-hidden");
  const toggle = $("toggleDetails");
  if (toggle) toggle.textContent = "細かい診断結果を見る ▼";

  // 深掘り用コンテキスト ＋ 提案チップ ＋ ログ初期化
  lastReadingContext =
    "【特徴】" + (out.features || []).map((f) => `${f.name}:${f.value}`).join("、") +
    "\n【総合コメント】" + (out.reading || "") +
    "\n【運勢】" + (out.fortunes || []).map((f) => `${f.name}★${f.stars}:${f.text}`).join("／");
  renderSuggestions(out.suggestions || []);
  $("qaLog").innerHTML = "";
  setLine($("followStatus"), "");

  resultCard.classList.remove("is-hidden");
  resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderSuggestions(list) {
  const el = $("suggestChips");
  el.innerHTML = "";
  (list || []).slice(0, 4).forEach((q) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "suggest-chip";
    b.textContent = q;
    b.addEventListener("click", () => askFollowup(q));
    el.appendChild(b);
  });
}

function appendQa(role, text) {
  const log = $("qaLog");
  const div = document.createElement("div");
  div.className = role === "Q" ? "qa-q" : "qa-a";
  div.textContent = text;
  log.appendChild(div);
}

async function askFollowup(question) {
  const q = String(question || $("followInput").value || "").trim();
  if (!q) {
    setLine($("followStatus"), "質問を入力してください", "err");
    return;
  }
  const key = getKey();
  if (!key) {
    setLine($("followStatus"), "先に設定からAPIキーを登録してください", "err");
    openSettings();
    return;
  }
  appendQa("Q", q);
  $("followInput").value = "";
  setLine($("followStatus"), "考え中…", "loading");
  try {
    const ruleBook = typeof PALM_KNOWLEDGE !== "undefined" ? PALM_KNOWLEDGE : "";
    const sys =
      "あなたは手相診断士です。下記の【診断結果】と【手相ルールブック】を踏まえ、相談者の質問に手相の観点からやさしく具体的に答えます。ルールブックの範囲を尊重し、エンタメとして前向きな語り口で。3〜6文程度。\n\n【診断結果】\n" +
      lastReadingContext + "\n\n" + ruleBook;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.6,
        messages: [{ role: "system", content: sys }, { role: "user", content: q }],
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error("OpenAIエラー (" + res.status + "): " + t.slice(0, 200));
    }
    const data = await res.json();
    appendQa("A", data.choices?.[0]?.message?.content || "");
    setLine($("followStatus"), "");
  } catch (e) {
    setLine($("followStatus"), e.message, "err");
  }
}

// events
$("openSettings").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) closeSettings();
});
$("toggleKey").addEventListener("click", () => {
  const t = apiKeyInput.type === "password";
  apiKeyInput.type = t ? "text" : "password";
  $("toggleKey").textContent = t ? "隠す" : "表示";
});
$("saveKey").addEventListener("click", () => {
  localStorage.setItem(LS_KEY, apiKeyInput.value.trim());
  refreshKeyStatus();
  flashButton($("saveKey"), "保存しました ✓");
  setTimeout(closeSettings, 600);
});
$("clearKey").addEventListener("click", () => {
  localStorage.removeItem(LS_KEY);
  apiKeyInput.value = "";
  refreshKeyStatus();
  flashButton($("clearKey"), "削除しました");
});

fileInput.addEventListener("change", (e) => onFile(e.target.files[0]));

const dropArea = $("dropArea");
dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropArea.classList.add("dragover");
});
dropArea.addEventListener("dragleave", (e) => {
  if (!dropArea.contains(e.relatedTarget)) dropArea.classList.remove("dragover");
});
dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.classList.remove("dragover");
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith("image/")) onFile(f);
  else setStatus("画像ファイルをドロップしてください", "err");
});
retakeButton.addEventListener("click", (e) => {
  e.preventDefault();
  imageDataUrl = "";
  preview.classList.add("is-hidden");
  dropInner.classList.remove("is-hidden");
  retakeButton.classList.add("is-hidden");
  resultCard.classList.add("is-hidden");
  fileInput.value = "";
  setStatus("");
});
diagnoseButton.addEventListener("click", diagnose);

$("followSend").addEventListener("click", () => askFollowup());
$("followInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") askFollowup();
});

$("toggleDetails").addEventListener("click", () => {
  const detailsEl = $("details");
  const hidden = detailsEl.classList.toggle("is-hidden");
  $("toggleDetails").textContent = hidden ? "細かい診断結果を見る ▼" : "細かい診断結果を閉じる ▲";
});

refreshKeyStatus();

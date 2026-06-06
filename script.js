// 手相占い診断（OpenAI Vision）
// WORKER_URL を設定すると「視聴者はキー不要」モード（りょうやのキーをCloudflare Workerに隠して代理実行）。
// 空のままだと従来どおり「各自のAPIキー」モード。
const WORKER_URL = "https://palm-proxy.ryoyatennis95s.workers.dev"; // りょうやのキーを隠す代理サーバー（視聴者キー不要）
const USE_WORKER = !!WORKER_URL;

const LS_KEY = "codex-palm-openai-key";
const $ = (id) => document.getElementById(id);

// OpenAI 呼び出し（Workerモード or 自分キーモードを自動で切り替え）
async function callOpenAI(payload) {
  if (USE_WORKER) {
    return fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }
  return fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + getKey() },
    body: JSON.stringify(payload),
  });
}

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
let lastResultData = null;

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
  if (!USE_WORKER && !getKey()) {
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
    "重要：必ず画像から読み取った特徴だけを使うこと。テンプレート的な一般回答や、毎回同じ決め打ちの内容を返すことは禁止。手のひらが写ってさえいれば必ず診断すること。細かい線が多少見えにくくても、見える範囲で粗く判定して読み解くこと（完璧な鮮明さは要求しない）。ok:false にしてよいのは『画像に手のひらがまったく写っていない（手以外の被写体）』か『真っ暗・極端なブレで手だと判別すらできない』場合だけに厳密に限る。" +
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
    "featuresは4〜6個。readingはたっぷり長く。fortunesとdetailsは必ずこの5項目・starsは1〜5の整数。suggestionsは4つ・この手相に合わせた具体的な質問文。detailsは各運勢の判定根拠（観察した特徴とルールの対応）を明確に。手のひらがある程度でも写っていれば、多少線が薄くても必ず ok:true で診断する。画像に手のひらがまったく写っていない（手以外の被写体）、または真っ暗・極端なブレで手だと判別すらできない場合のみ {\"ok\":false,\"message\":\"手のひらがはっきり写っていません。明るい場所で手のひら全体を撮り直してください。\"} を返す。";

  setStatus("手相を読み取り中…（10〜20秒ほど）", "loading");
  diagnoseButton.disabled = true;
  try {
    const res = await callOpenAI({
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

  // 結果データを保持（画像保存に使う）
  lastResultData = out;
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
  if (!USE_WORKER && !getKey()) {
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
    const res = await callOpenAI({
      model: "gpt-4o-mini",
      temperature: 0.6,
      messages: [{ role: "system", content: sys }, { role: "user", content: q }],
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

/* ===== 診断結果カードを画像化して保存 ===== */
function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  String(text || "").split("\n").forEach((para) => {
    let line = "";
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    lines.push(line);
  });
  return lines;
}

function buildResultCard(out) {
  const W = 1080, H = 1500, P = 80;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const x = cv.getContext("2d");
  // 背景（神秘的なグラデ）
  const g = x.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#2b1d52"); g.addColorStop(0.5, "#1a1838"); g.addColorStop(1, "#0e1330");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // 飾り枠
  x.strokeStyle = "rgba(212,180,90,0.55)"; x.lineWidth = 3;
  x.strokeRect(28, 28, W - 56, H - 56);
  x.textAlign = "center";
  // ヘッダー
  x.fillStyle = "#E7C873"; x.font = "600 30px -apple-system,BlinkMacSystemFont,sans-serif";
  x.fillText("✦  AI PALM READING  ✦", W / 2, 110);
  x.fillStyle = "#ffffff"; x.font = "800 66px -apple-system,BlinkMacSystemFont,sans-serif";
  x.fillText("手相占い診断", W / 2, 185);
  x.fillStyle = "rgba(255,255,255,0.55)"; x.font = "400 26px -apple-system,sans-serif";
  const d = new Date();
  x.fillText(`${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`, W / 2, 230);
  x.strokeStyle = "rgba(212,180,90,0.4)"; x.lineWidth = 2;
  x.beginPath(); x.moveTo(P, 262); x.lineTo(W - P, 262); x.stroke();

  let y = 320;
  x.textAlign = "left";
  const sectionTitle = (t) => {
    x.fillStyle = "#E7C873"; x.font = "700 32px -apple-system,sans-serif";
    x.fillText(t, P, y); y += 46;
  };

  // 読み取った手相
  sectionTitle("読み取った手相");
  x.font = "400 28px -apple-system,sans-serif"; x.fillStyle = "rgba(255,255,255,0.92)";
  (out.features || []).slice(0, 5).forEach((f) => {
    x.fillText(`・${f.name}：${f.value || ""}`, P + 8, y); y += 40;
  });
  y += 22;

  // 運勢（星）
  sectionTitle("運勢");
  (out.fortunes || []).slice(0, 5).forEach((f) => {
    const n = Math.max(0, Math.min(5, Number(f.stars) || 0));
    x.fillStyle = "rgba(255,255,255,0.92)"; x.font = "600 29px -apple-system,sans-serif";
    x.fillText(f.name || "", P + 8, y);
    x.fillStyle = "#F2C94C"; x.font = "600 29px -apple-system,sans-serif"; x.textAlign = "right";
    x.fillText("★★★★★☆☆☆☆☆".slice(5 - n, 10 - n), W - P, y);
    x.textAlign = "left";
    y += 44;
  });
  y += 22;

  // 開運
  const l = out.lucky || {};
  if (l.color || l.item || l.action) {
    sectionTitle("開運");
    x.font = "400 28px -apple-system,sans-serif"; x.fillStyle = "rgba(255,255,255,0.92)";
    if (l.color)  { x.fillText(`ラッキーカラー：${l.color}`, P + 8, y); y += 40; }
    if (l.item)   { x.fillText(`ラッキーアイテム：${l.item}`, P + 8, y); y += 40; }
    if (l.action) { x.fillText(`開運アクション：${l.action}`, P + 8, y); y += 40; }
    y += 22;
  }

  // 総評
  if (out.summary) {
    sectionTitle("総評");
    x.font = "400 27px -apple-system,sans-serif"; x.fillStyle = "rgba(255,255,255,0.88)";
    const lines = wrapLines(x, out.summary, W - P * 2 - 8);
    lines.slice(0, 7).forEach((ln) => { x.fillText(ln, P + 8, y); y += 38; });
  }

  // フッター
  x.textAlign = "center"; x.fillStyle = "rgba(231,200,115,0.7)"; x.font = "500 24px -apple-system,sans-serif";
  x.fillText("✦  Codex × AI 手相占い診断  ✦", W / 2, H - 56);
  return cv;
}

function dataURLtoFile(dataurl, filename) {
  const [head, b64] = dataurl.split(",");
  const mime = (head.match(/:(.*?);/) || [])[1] || "image/png";
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new File([u8], filename, { type: mime });
}

function saveResultImage() {
  if (!lastResultData) {
    setLine($("saveStatus"), "先に診断してください", "err");
    return;
  }
  let dataUrl;
  try {
    // 同期で生成（toBlobの非同期コールバックだとユーザー操作判定が切れて保存がブロックされるため）
    dataUrl = buildResultCard(lastResultData).toDataURL("image/png");
  } catch (e) {
    setLine($("saveStatus"), "画像の生成に失敗しました", "err");
    return;
  }

  // スマホ（タッチ端末）：保存シートを出して「画像を保存」をワンタップ（iOSは直接保存できないため）
  const isTouch = window.matchMedia && window.matchMedia("(pointer:coarse)").matches;
  if (isTouch && navigator.canShare) {
    try {
      const file = dataURLtoFile(dataUrl, "手相占い診断.png");
      if (navigator.canShare({ files: [file] })) {
        navigator
          .share({ files: [file] })
          .then(() => setLine($("saveStatus"), "保存メニューから「画像を保存」を選んでね", "ok"))
          .catch(() => setLine($("saveStatus"), "", ""));
        return;
      }
    } catch (e) {}
  }

  // PC等：同期でそのままダウンロード
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = "手相占い診断.png";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setLine($("saveStatus"), "画像を保存しました", "ok");
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

const saveImageButton = $("saveImageButton");
if (saveImageButton) saveImageButton.addEventListener("click", saveResultImage);

$("followSend").addEventListener("click", () => askFollowup());
$("followInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") askFollowup();
});

$("toggleDetails").addEventListener("click", () => {
  const detailsEl = $("details");
  const hidden = detailsEl.classList.toggle("is-hidden");
  $("toggleDetails").textContent = hidden ? "細かい診断結果を見る ▼" : "細かい診断結果を閉じる ▲";
});

// Workerモードでは視聴者はキー不要 → 設定ボタンを隠す
if (USE_WORKER) {
  const s = $("openSettings");
  if (s) s.style.display = "none";
}
refreshKeyStatus();

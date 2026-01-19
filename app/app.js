const apiKeyInput = document.getElementById("apiKey");
const audioInput = document.getElementById("audioFile");
const modelSelect = document.getElementById("modelSelect");
const temperatureInput = document.getElementById("temperature");
const analyzeButton = document.getElementById("analyzeButton");
const statusBox = document.getElementById("status");
const resultCard = document.getElementById("resultCard");

const MAX_FILE_SIZE_MB = 20;

const setStatus = (message, isError = false) => {
  statusBox.textContent = message;
  statusBox.style.background = isError ? "#ffe7e7" : "#f1f4ff";
  statusBox.style.color = isError ? "#8a1f1f" : "#3a4380";
};

const renderResult = ({ summary, rationale, followups, rawText, metadata = [] }) => {
  resultCard.innerHTML = "";

  if (summary) {
    const summaryBlock = document.createElement("div");
    summaryBlock.className = "result-section";
    summaryBlock.innerHTML = `<div class="result-label">判定</div><p>${summary}</p>`;
    resultCard.appendChild(summaryBlock);
  }

  if (rationale) {
    const rationaleBlock = document.createElement("div");
    rationaleBlock.className = "result-section";
    rationaleBlock.innerHTML = `<div class="result-label">理由</div><p>${rationale}</p>`;
    resultCard.appendChild(rationaleBlock);
  }

  if (followups && followups.length > 0) {
    const followupBlock = document.createElement("div");
    followupBlock.className = "result-section";
    followupBlock.innerHTML = `<div class="result-label">追加で確認すべきポイント</div>`;
    const list = document.createElement("ul");
    followups.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
    followupBlock.appendChild(list);
    resultCard.appendChild(followupBlock);
  }

  if (!summary && rawText) {
    const text = document.createElement("p");
    text.textContent = rawText;
    resultCard.appendChild(text);
  }

  if (metadata.length > 0) {
    const list = document.createElement("ul");
    list.className = "meta";
    metadata.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
    resultCard.appendChild(list);
  }
};

const formatBytes = (bytes) => {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)}MB`;
};

const buildPrompt = () =>
  `次の音声ファイルを解析し、漏水音（配管からの水漏れや水が流れる異常音）かどうかを判定してください。\n` +
  `結果は必ずJSON形式で返してください。\n\n` +
  `JSONのスキーマ:\n` +
  `{\n` +
  `  "likelihood": "高" | "中" | "低",\n` +
  `  "rationale": "2〜3行の理由",\n` +
  `  "followups": ["追加で確認すべきポイント", "..."]\n` +
  `}\n` +
  `\n` +
  `JSON以外の文章は含めないでください。`;

const normalizeModel = (model) => {
  if (model === "gemini-1.5-pro") {
    return "gemini-1.5-pro-latest";
  }
  if (model === "gemini-1.5-flash") {
    return "gemini-1.5-flash-latest";
  }
  return model;
};

const fetchGeminiResult = async ({
  apiKey,
  base64Audio,
  mimeType,
  model,
  temperature,
}) => {
  const normalizedModel = normalizeModel(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${normalizedModel}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generationConfig: {
        temperature,
      },
      contents: [
        {
          role: "user",
          parts: [
            { text: buildPrompt() },
            {
              inline_data: {
                mime_type: mimeType,
                data: base64Audio,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    if (response.status === 404) {
      throw new Error(
        `Gemini API error: ${response.status}. モデル名が利用可能か確認してください。`
      );
    }
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

  const payload = await response.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Geminiからの返答が取得できませんでした。");
  }
  return text;
};

const fileToBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("ファイル読み込みに失敗しました。"));
        return;
      }
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error || new Error("読み込みエラー"));
    reader.readAsDataURL(file);
  });

const validateInputs = () => {
  const apiKey = apiKeyInput.value.trim();
  const file = audioInput.files?.[0];
  const model = modelSelect.value;
  const temperature = Number(temperatureInput.value);

  if (!apiKey) {
    setStatus("APIキーを入力してください。", true);
    return null;
  }

  if (!file) {
    setStatus("音声ファイルを選択してください。", true);
    return null;
  }

  if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
    setStatus(`ファイルサイズが大きすぎます (${formatBytes(file.size)})。`, true);
    return null;
  }

  if (Number.isNaN(temperature) || temperature < 0 || temperature > 1) {
    setStatus("温度は0.0〜1.0の範囲で入力してください。", true);
    return null;
  }

  return { apiKey, file, model: normalizeModel(model), temperature };
};

const updateButtonState = () => {
  analyzeButton.disabled =
    !apiKeyInput.value.trim() || !audioInput.files?.length;
};

apiKeyInput.addEventListener("input", updateButtonState);
audioInput.addEventListener("change", () => {
  updateButtonState();
  const file = audioInput.files?.[0];
  if (file) {
    setStatus(`選択中: ${file.name} (${formatBytes(file.size)})`);
  }
});

analyzeButton.addEventListener("click", async () => {
  const inputs = validateInputs();
  if (!inputs) {
    return;
  }

  analyzeButton.disabled = true;
  setStatus("Geminiへ送信中...。");
  renderResult({ rawText: "解析中です。しばらくお待ちください..." });

  try {
    const base64Audio = await fileToBase64(inputs.file);
    const result = await fetchGeminiResult({
      apiKey: inputs.apiKey,
      base64Audio,
      mimeType: inputs.file.type || "audio/wav",
      model: inputs.model,
      temperature: inputs.temperature,
    });

    let parsed = null;
    try {
      parsed = JSON.parse(result);
    } catch (parseError) {
      console.warn("JSON parse failed", parseError);
    }

    if (parsed?.likelihood) {
      renderResult({
        summary: `漏水音の可能性: ${parsed.likelihood}`,
        rationale: parsed.rationale,
        followups: parsed.followups,
        metadata: [
          `ファイル名: ${inputs.file.name}`,
          `MIMEタイプ: ${inputs.file.type || "audio/wav"}`,
          `モデル: ${inputs.model}`,
          `温度: ${inputs.temperature}`,
        ],
      });
    } else {
      renderResult({
        rawText: result,
        metadata: [
          `ファイル名: ${inputs.file.name}`,
          `MIMEタイプ: ${inputs.file.type || "audio/wav"}`,
          `モデル: ${inputs.model}`,
          `温度: ${inputs.temperature}`,
        ],
      });
    }
    setStatus("判定が完了しました。");
  } catch (error) {
    console.error(error);
    renderResult({
      rawText: "エラーが発生しました。APIキーとファイル形式を確認してください。",
    });
    setStatus(error.message, true);
  } finally {
    updateButtonState();
  }
});

updateButtonState();

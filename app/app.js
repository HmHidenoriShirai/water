const apiKeyInput = document.getElementById("apiKey");
const audioInput = document.getElementById("audioFile");
const analyzeButton = document.getElementById("analyzeButton");
const statusBox = document.getElementById("status");
const resultCard = document.getElementById("resultCard");

const MAX_FILE_SIZE_MB = 20;

const setStatus = (message, isError = false) => {
  statusBox.textContent = message;
  statusBox.style.background = isError ? "#ffe7e7" : "#f1f4ff";
  statusBox.style.color = isError ? "#8a1f1f" : "#3a4380";
};

const renderResult = (resultText, metadata = []) => {
  resultCard.innerHTML = "";

  const text = document.createElement("p");
  text.textContent = resultText;
  resultCard.appendChild(text);

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
  `次の音声ファイルを解析し、漏水音（配管からの水漏れや水が流れる異常音）かどうかを判定してください。\n\n` +
  `1) 判定結果を「漏水音の可能性: 高 / 中 / 低」で示す\n` +
  `2) 判断理由を2〜3行で説明する\n` +
  `3) 必要なら追加で確認すべきポイントを提案する`;

const fetchGeminiResult = async ({ apiKey, base64Audio, mimeType }) => {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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

  return { apiKey, file };
};

const updateButtonState = () => {
  analyzeButton.disabled = !apiKeyInput.value.trim() || !audioInput.files?.length;
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
  renderResult("解析中です。しばらくお待ちください...");

  try {
    const base64Audio = await fileToBase64(inputs.file);
    const result = await fetchGeminiResult({
      apiKey: inputs.apiKey,
      base64Audio,
      mimeType: inputs.file.type || "audio/wav",
    });

    renderResult(result, [
      `ファイル名: ${inputs.file.name}`,
      `MIMEタイプ: ${inputs.file.type || "audio/wav"}`,
    ]);
    setStatus("判定が完了しました。");
  } catch (error) {
    console.error(error);
    renderResult("エラーが発生しました。APIキーとファイル形式を確認してください。");
    setStatus(error.message, true);
  } finally {
    updateButtonState();
  }
});

updateButtonState();

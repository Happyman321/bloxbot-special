const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const vscode = require("vscode");

let provider;

function activate(context) {
  provider = new CompanionViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("bloxbotCompanion", provider),
    vscode.commands.registerCommand("bloxbotCompanion.connect", connectCompanion),
    vscode.commands.registerCommand("bloxbotCompanion.refresh", () => provider.refresh()),
  );
  provider.startPolling(context);
}

function deactivate() {}

async function connectCompanion() {
  const config = vscode.workspace.getConfiguration("bloxbotCompanion");
  const currentUrl = config.get("bridgeUrl") || "http://127.0.0.1:59300";
  const bridgeUrl = await vscode.window.showInputBox({
    title: "BloxBot bridge URL",
    value: currentUrl,
    ignoreFocusOut: true,
  });
  if (!bridgeUrl) return;
  const token = await vscode.window.showInputBox({
    title: "BloxBot bridge token",
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) return;
  await config.update("bridgeUrl", bridgeUrl, vscode.ConfigurationTarget.Global);
  await config.update("bridgeToken", token, vscode.ConfigurationTarget.Global);
  provider?.refresh();
  vscode.window.showInformationMessage("BloxBot companion connected.");
}

class CompanionViewProvider {
  constructor(extensionUri) {
    this.extensionUri = extensionUri;
    this.view = null;
    this.proposals = [];
    this.selectedProposalId = null;
    this.selectedChangeIndex = 0;
    this.pollTimer = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.html(view.webview);
    view.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.postState();
    this.refresh();
  }

  startPolling(context) {
    this.pollTimer = setInterval(() => this.refresh(), 2000);
    context.subscriptions.push({ dispose: () => clearInterval(this.pollTimer) });
  }

  async refresh() {
    try {
      const data = await bridgeRequest("GET", "/proposals");
      this.proposals = (data.proposals || []).filter((proposal) => proposal.status === "pending");
      if (!this.proposals.some((proposal) => proposal.id === this.selectedProposalId)) {
        this.selectedProposalId = this.proposals[0]?.id || null;
        this.selectedChangeIndex = 0;
      }
      this.postState();
    } catch (error) {
      this.postState(String(error.message || error));
    }
  }

  postState(error) {
    if (!this.view) return;
    this.view.webview.postMessage({
      type: "state",
      proposals: this.proposals,
      selectedProposalId: this.selectedProposalId,
      selectedChangeIndex: this.selectedChangeIndex,
      connected: !!getBridgeToken(),
      error,
    });
  }

  async handleMessage(message) {
    if (message.command === "connect") {
      await connectCompanion();
      return;
    }
    if (message.command === "refresh") {
      await this.refresh();
      return;
    }
    if (message.command === "select") {
      this.selectedProposalId = message.proposalId;
      this.selectedChangeIndex = Number(message.changeIndex || 0);
      this.postState();
      await this.openSelected();
      return;
    }
    if (message.command === "next") {
      this.moveSelection(1);
      await this.openSelected();
      return;
    }
    if (message.command === "previous") {
      this.moveSelection(-1);
      await this.openSelected();
      return;
    }
    if (message.command === "open") {
      await this.openSelected();
      return;
    }
    if (message.command === "approve") {
      await this.approveSelected();
      return;
    }
    if (message.command === "deny") {
      await this.denySelected();
    }
  }

  selectedProposal() {
    return this.proposals.find((proposal) => proposal.id === this.selectedProposalId) || null;
  }

  selectedChange() {
    const proposal = this.selectedProposal();
    if (!proposal) return null;
    return proposal.changes[this.selectedChangeIndex] || null;
  }

  moveSelection(delta) {
    const proposal = this.selectedProposal();
    if (!proposal || proposal.changes.length === 0) return;
    const next = this.selectedChangeIndex + delta;
    this.selectedChangeIndex = (next + proposal.changes.length) % proposal.changes.length;
    this.postState();
  }

  async openSelected() {
    const proposal = this.selectedProposal();
    const change = this.selectedChange();
    if (!proposal || !change) return;
    const target = resolveInside(proposal.workspacePath, change.relativePath);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  async approveSelected() {
    const proposal = this.selectedProposal();
    if (!proposal) return;
    try {
      for (const change of proposal.changes) {
        const target = resolveInside(proposal.workspacePath, change.relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, change.content, "utf8");
      }
      await bridgeRequest("POST", `/proposals/${encodeURIComponent(proposal.id)}/decision`, {
        decision: "approve",
        result: `Approved and applied ${proposal.changes.length} file change(s) in VS Code.`,
      });
      vscode.window.showInformationMessage("BloxBot changes applied.");
      await this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to apply BloxBot changes: ${error.message || error}`);
    }
  }

  async denySelected() {
    const proposal = this.selectedProposal();
    if (!proposal) return;
    await bridgeRequest("POST", `/proposals/${encodeURIComponent(proposal.id)}/decision`, {
      decision: "deny",
      result: "Denied in VS Code. No files were changed.",
    });
    vscode.window.showInformationMessage("BloxBot changes denied.");
    await this.refresh();
  }

  html() {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { padding: 10px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); }
    button { margin: 2px; }
    .muted { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .proposal { border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px; margin-bottom: 8px; }
    .selected { border-color: var(--vscode-focusBorder); }
    .file { display: block; width: 100%; text-align: left; overflow: hidden; text-overflow: ellipsis; }
    .summary { font-weight: 600; margin-bottom: 4px; }
    .row { display: flex; gap: 4px; flex-wrap: wrap; margin: 8px 0; }
    code { font-family: var(--vscode-editor-font-family); font-size: 11px; }
  </style>
</head>
<body>
  <div class="row">
    <button id="connect">Connect</button>
    <button id="refresh">Refresh</button>
  </div>
  <div id="status" class="muted"></div>
  <div class="row">
    <button id="previous">Previous</button>
    <button id="next">Next</button>
    <button id="open">Open</button>
  </div>
  <div class="row">
    <button id="approve">Approve</button>
    <button id="deny">Deny</button>
  </div>
  <div id="content"></div>
  <script>
    const vscode = acquireVsCodeApi();
    let state = { proposals: [], selectedProposalId: null, selectedChangeIndex: 0 };
    const byId = (id) => document.getElementById(id);
    byId("connect").onclick = () => vscode.postMessage({ command: "connect" });
    byId("refresh").onclick = () => vscode.postMessage({ command: "refresh" });
    byId("previous").onclick = () => vscode.postMessage({ command: "previous" });
    byId("next").onclick = () => vscode.postMessage({ command: "next" });
    byId("open").onclick = () => vscode.postMessage({ command: "open" });
    byId("approve").onclick = () => vscode.postMessage({ command: "approve" });
    byId("deny").onclick = () => vscode.postMessage({ command: "deny" });
    window.addEventListener("message", (event) => {
      if (event.data.type !== "state") return;
      state = event.data;
      render();
    });
    function render() {
      byId("status").textContent = state.error
        ? state.error
        : state.connected
          ? state.proposals.length + " pending change request(s)"
          : "Not connected to BloxBot.";
      const content = byId("content");
      content.innerHTML = "";
      if (!state.proposals.length) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No pending BloxBot changes.";
        content.appendChild(empty);
        return;
      }
      for (const proposal of state.proposals) {
        const wrap = document.createElement("div");
        wrap.className = "proposal" + (proposal.id === state.selectedProposalId ? " selected" : "");
        const summary = document.createElement("div");
        summary.className = "summary";
        summary.textContent = proposal.summary;
        wrap.appendChild(summary);
        const path = document.createElement("div");
        path.className = "muted";
        path.textContent = proposal.workspacePath;
        wrap.appendChild(path);
        proposal.changes.forEach((change, index) => {
          const btn = document.createElement("button");
          btn.className = "file";
          btn.textContent = (proposal.id === state.selectedProposalId && index === state.selectedChangeIndex ? "> " : "") + change.relativePath;
          btn.onclick = () => vscode.postMessage({ command: "select", proposalId: proposal.id, changeIndex: index });
          wrap.appendChild(btn);
        });
        content.appendChild(wrap);
      }
    }
  </script>
</body>
</html>`;
  }
}

function getBridgeConfig() {
  const config = vscode.workspace.getConfiguration("bloxbotCompanion");
  return {
    url: config.get("bridgeUrl") || "http://127.0.0.1:59300",
    token: config.get("bridgeToken") || "",
  };
}

function getBridgeToken() {
  return getBridgeConfig().token;
}

function bridgeRequest(method, requestPath, body) {
  const config = getBridgeConfig();
  if (!config.token) {
    return Promise.reject(new Error("Run BloxBot: Connect Companion first."));
  }
  const url = new URL(requestPath, config.url);
  url.searchParams.set("token", config.token);
  const payload = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method,
        headers: payload
          ? { "content-type": "application/json", "content-length": String(payload.length) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = {};
          try {
            parsed = text ? JSON.parse(text) : {};
          } catch {
            reject(new Error(`Invalid BloxBot bridge response: ${text}`));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(parsed.error || `BloxBot bridge returned HTTP ${res.statusCode}`));
            return;
          }
          resolve(parsed);
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function resolveInside(workspacePath, relativePath) {
  const root = path.resolve(workspacePath);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes workspace: ${relativePath}`);
  }
  return target;
}

module.exports = { activate, deactivate };

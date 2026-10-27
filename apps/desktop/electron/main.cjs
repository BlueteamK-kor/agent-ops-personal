require("./stdio.cjs").protectStdio();
const { app, BrowserWindow, ipcMain, session, dialog, safeStorage, shell, clipboard, nativeImage } = require("electron");
const { CodexConnection } = require("./codex.cjs");
const { PersonalError } = require("./personal.cjs");
const { AgentProfiles } = require("./agents.cjs");
const { TeamCoordinator } = require('./team.cjs');
const { KnowledgeStore, enrich } = require('./knowledge.cjs');
const { GoogleAccounts } = require('./google-accounts.cjs');
const { GeminiCli } = require('./gemini-cli.cjs');
const fs = require('node:fs');
const { SlackConnector } = require("./slack.cjs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { Bridge, METHODS } = require("./bridge.cjs");
const { trustedFrame, bundledResource } = require("./security.cjs");
const { UiPreferences } = require('./preferences.cjs');
const { DesktopUpdates } = require('./updates.cjs');
const { exportDocument, exportImage } = require('./workspace-export.cjs');
const { prepareMessages } = require('./transmission-policy.cjs');
const { imageData, OUTPUT_LIMIT } = require('./image-data.cjs');
function validateImage(value, limit) {
  const { bytes } = imageData(value, limit);
  const decoded = nativeImage.createFromBuffer(bytes);
  const { width, height } = decoded.getSize();
  if (decoded.isEmpty() || width * height > 16000000) throw new PersonalError('image_invalid');
}
const { WorkspaceStore } = require('./workspace-store.cjs');
const { WorkspaceImporter } = require('./workspace-import.cjs');
const { CodexHistory } = require('./codex-history.cjs');
const { Conversations } = require('./conversations.cjs');
const conversations = new Conversations();
const { FileTask } = require('./file-task.cjs');
const fileTask = new FileTask();

// This utility has no WebGL/video surfaces. Avoid retaining a hardware compositor
// allocation for a mostly static control window; background work lives outside Electron.
app.disableHardwareAcceleration();

const isolatedUserData = app.commandLine.getSwitchValue("user-data-dir");
if (isolatedUserData) app.setPath("userData", path.resolve(isolatedUserData));
const bridge = new Bridge({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, version: app.getVersion() });
const entry = pathToFileURL(path.join(__dirname, "../dist/index.html")).href;
let window;
let setupActive = false;
let setupMonitor;
let personal;
let slack;
let codex;
let agents;
let team;
let knowledge;
let workspace;
const workspaceImporter = new WorkspaceImporter();
let googleAccounts;
let geminiCli;
let updates;
let personalDialogActive = false;
let t = text => text;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const { translate } = await import('./i18n.mjs');
    const preferences = new UiPreferences(app.getPath('userData'));
    t = text => translate(text, preferences.language);
    for (const method of ['read', 'save']) {
      ipcMain.handle(`btk:preferences:${method}`, (event, params) => {
        if (!trustedFrame(event, window, entry)) throw new Error('Untrusted request');
        return method === 'read' ? preferences.read() : preferences.save(params?.language);
      });
    }
    let personalFailure = false;
    try {
      const directory = path.join(app.getPath("userData"), "agent-ops-personal");
      const relative = path.relative(path.resolve(__dirname, "../../.."), directory);
      if (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)) throw new Error();
      googleAccounts = new GoogleAccounts({ directory, safeStorage, openExternal: url => shell.openExternal(url) });
      geminiCli = new GeminiCli({ directory });
      agents = new AgentProfiles({ directory, safeStorage, googleAccounts, geminiCli });
      knowledge = new KnowledgeStore({ directory, safeStorage });
      workspace = new WorkspaceStore({ directory, safeStorage });
      personal = agents.service;
      slack = new SlackConnector({ personal });
      codex = new CodexConnection({ directory: agents.location(agents.data.selected), openExternal: url => shell.openExternal(url) });
    } catch { personalFailure = true; }
    const workspaceRequest = (event, method, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('workspace_storage');
      if (method === 'read') {
        const groups = workspace.load();
        return Object.fromEntries(Object.entries(groups).filter(([id]) => agents.data.agents.some(agent => agent.id === id)));
      }
      if (!params || Object.keys(params).some(id => !agents.data.agents.some(agent => agent.id === id))) throw new Error('workspace_storage');
      return workspace.save(params);
    };
    for (const method of ['read', 'save']) ipcMain.handle(`btk:workspace:${method}`, (event, params) => workspaceRequest(event, method, params));
    for (const method of ['import', 'folder']) ipcMain.handle(`btk:history:${method}`, async (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new PersonalError('개인용 모드에서만 이력을 가져올 수 있습니다.');
      if (params?.agentId !== agents.data.selected) throw new PersonalError('대화의 에이전트가 변경되었습니다. 선택 상태를 확인해 주세요.');
      personal.idle();
      if (conversations.active || team.active || personalDialogActive || codex.loginId || googleAccounts.pending || geminiCli.pending) throw new PersonalError('진행 중인 요청을 먼저 중단해 주세요.');
      personalDialogActive = true;
      try {
        const groups = workspace.load();
        if (method === 'folder') {
          const imported = groups[params.agentId]?.items.find(item => item.id === params.sessionId)?.importedFrom;
          if (!imported) throw new PersonalError('가져온 세션을 선택해 주세요.');
          return agents.state(personal.workspace(imported.cwd));
        }
        const answer = await dialog.showMessageBox(window, { type: 'question', title: t('VS Code 세션 가져오기'),
          message: t('최근 7일의 VS Code Codex 대화를 가져올까요?'),
          detail: t('대화와 도구 실행 기록을 이 PC의 암호화된 앱 저장소에 복사합니다. 원본은 변경하지 않으며 모델 요청은 보내지 않습니다.'),
          buttons: [t('취소'), t('가져오기')], defaultId: 0, cancelId: 0 });
        if (answer.response !== 1) throw new PersonalError('가져오기를 취소했습니다.');
        return await new CodexHistory({ directory: agents.directory, safeStorage }).import(groups, params.agentId);
      } finally { personalDialogActive = false; }
    });
    ipcMain.on('btk:workspace:flush', (event, params) => {
      try { event.returnValue = workspaceRequest(event, 'save', params); }
      catch { event.returnValue = { saved: false }; }
    });
    ipcMain.handle('btk:workspace:import', async (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('source_content');
      return workspaceImporter.read(params);
    });
    ipcMain.handle('btk:workspace:import-file', async (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('source_content');
      return workspaceImporter.readFile(params?.filePath);
    });
    const complete = async (messages, options) => {
      if (!options?.probe && Array.isArray(messages)) messages = enrich(messages, knowledge.snapshot(agents.data.selected), messages.at(-1)?.content);
      if (personal.data.connection !== "codex") return personal.complete(messages, options);
      personal.idle(); personal.codexActive = true;
      try { return await codex.complete(messages, personal.data.codexModel, personal.data.codexReasoningEffort || '', options?.execution); }
      finally { personal.codexActive = false; }
    };
    const executeConversation = async (params, agent, service, perform, cancelled = () => false) => {
      const generating = params.output === 'image';
      const messages = prepareMessages(params.messages, { ErrorType: PersonalError });
      const images = messages.flatMap(message => message.images || []), imageModel = params.imageModel;
      if (generating && (typeof imageModel !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(imageModel) || agent.connection === 'codex' || !['openai', 'gemini', 'compatible', 'local'].includes(agent.provider))) throw new PersonalError('image_unsupported');
      if (generating && (images.length || messages.length !== 1)) throw new PersonalError('image_prompt_only');
      for (const image of images) validateImage(image);
      if (generating || images.length) {
        service.idle(); personalDialogActive = true;
        try {
          const answer = await dialog.showMessageBox(window, { type: 'question', title: t('이미지 요청 확인'), buttons: [t('취소'), t('계속')], defaultId: 0, cancelId: 0,
            message: t(generating ? '선택한 모델로 이미지를 생성할까요?' : '첨부 이미지를 선택한 모델에 전송할까요?'),
            detail: `${agent.endpoint}\n${generating ? imageModel : agent.model}\n${t('이미지 수')}: ${images.length}\n${t('공급자 사용량 또는 API 요금이 발생합니다. 이미지 내부의 민감 정보는 자동 검사하지 않습니다.')}` });
          if (answer.response !== 1 || cancelled()) throw new PersonalError('요청을 취소했습니다.');
        } finally { personalDialogActive = false; }
      }
      if (generating && params.access && params.access !== 'chat') throw new PersonalError('지원하지 않는 실행 권한입니다.');
      let execution;
      if (params.access !== undefined && params.access !== 'chat') {
        service.idle(); personalDialogActive = true;
        try {
          execution = await require('./execution-access.cjs').authorizeExecution(params.access, agent, async info => {
            const answer = await dialog.showMessageBox(window, { type: 'warning', title: t('전체 접근 승인'), message: t('이 요청에 전체 접근을 허용할까요?'),
              detail: `${info.agentName}\n${info.model}\n${info.cwd}\n\n${t('작업 폴더 밖을 포함하여 현재 사용자 권한으로 파일 읽기·수정·삭제, 명령 실행 및 네트워크 전송이 가능합니다. 파일과 도구 결과가 모델 공급자에게 전송될 수 있으며 자동 민감 정보 검사를 보장하지 않습니다. 관리자 권한을 부여하지 않습니다. 이 요청에만 적용되며, 중단해도 이미 수행한 변경은 되돌리지 않습니다.')}`,
              buttons: [t('취소'), t('이번 요청 허용')], defaultId: 0, cancelId: 0 });
            return answer.response === 1 && !cancelled();
          }, async () => {
            const selection = await dialog.showOpenDialog(window, { title: t('전체 접근 작업 폴더'), properties: ['openDirectory'] });
            if (selection.canceled || !selection.filePaths[0] || cancelled()) return undefined;
            const value = service.workspace(selection.filePaths[0]);
            if (agents.data.selected === agent.agentId) personal.data = { ...personal.data, workspace: value.workspace };
            return value.workspace;
          });
        } finally { personalDialogActive = false; }
      }
      if (cancelled()) throw new PersonalError('요청을 취소했습니다.');
      const result = await perform(messages, generating ? { imageModel } : { execution });
      for (const image of result.images || []) validateImage(image, OUTPUT_LIMIT);
      return { ...result, agentId: agent.agentId, agentName: agent.agentName, model: generating ? imageModel : agent.model };
    };
    conversations.on('change', value => { if (window && !window.isDestroyed()) window.webContents.send('btk:sessions:changed', value); });
    for (const method of ['state', 'submit', 'cancel']) ipcMain.handle(`btk:sessions:${method}`, async (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('Untrusted request');
      if (method === 'state') return conversations.state();
      if (method === 'cancel') return conversations.cancel(params);
      try {
        if (params?.agentId !== agents.data.selected) throw new PersonalError('대화의 에이전트가 변경되었습니다. 선택 상태를 확인해 주세요.');
        personal.idle();
        if (team.active || setupActive || codex.loginId || googleAccounts.pending || geminiCli.pending || (personalDialogActive && !conversations.active)) throw new PersonalError('진행 중인 요청을 먼저 중단해 주세요.');
        if (!['chat', 'full'].includes(params.access) || !['chat', 'image'].includes(params.output)) throw new PersonalError('지원하지 않는 실행 권한입니다.');
        const source = workspace.load()[params.agentId]?.items.find(item => item.id === params.sessionId);
        if (!source) throw new PersonalError('대화 요청 정보를 확인해 주세요.');
        const cwd = source.importedFrom?.cwd;
        const identity = { agentId: params.agentId, agentName: agents.data.agents.find(item => item.id === params.agentId).name };
        const messages = prepareMessages(params.messages, { ErrorType: PersonalError });
        const snapshot = knowledge.snapshot(params.agentId);
        const input = { ...params, messages };
        const exclusive = params.access === 'full' || params.output === 'image' || messages.some(message => message.images?.length);
        return await conversations.submit({ ...params, exclusive }, cancelled => {
          const service = agents.open(params.agentId);
          service.data = { ...service.data, workspace: cwd || service.data.workspace };
          const agent = { ...service.state(), ...identity };
          const connection = agent.connection === 'codex' ? new CodexConnection({ directory: agents.location(params.agentId), cwd, openExternal: url => shell.openExternal(url) }) : null;
          const perform = (rows, options) => {
            const enriched = enrich(rows, snapshot, rows.at(-1)?.content);
            return connection ? connection.complete(enriched, agent.model, agent.reasoningEffort || '', options?.execution) : service.complete(enriched, options);
          };
          return { run: () => executeConversation(input, agent, service, perform, cancelled), cancel: () => connection ? connection.cancel() : service.cancel(), close: () => connection?.stop() };
        });
      } catch (error) { throw new Error(error instanceof PersonalError ? error.message : '개인용 요청을 처리하지 못했습니다.'); }
    });
    for (const method of ['generate', 'apply', 'cancel']) ipcMain.handle(`btk:file-task:${method}`, async (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('Untrusted request');
      if (params?.agentId !== agents.data.selected) throw new Error('file_task_expired');
      if (method === 'cancel') {
        if (!fileTask.active) return { cancelled: false };
        fileTask.cancelled = true;
        return personal.data.connection === 'codex' ? codex.cancel() : personal.cancel();
      }
      personal.idle();
      if (conversations.active || personalDialogActive || team.active || setupActive || codex.loginId || googleAccounts.pending || geminiCli.pending) throw new Error('file_task_busy');
      personalDialogActive = true;
      try {
        const agent = agents.state();
        const bound = { agentId: agent.agentId, root: personal.data.workspace };
        if (method === 'generate') return await fileTask.generate({ ...bound, relative: params.path, objective: params.objective }, {
          complete,
          confirm: async info => (await dialog.showMessageBox(window, { type: 'question', title: t('파일 작업'),
            message: t('선택한 파일 내용과 요청을 모델에 보낼까요?'),
            detail: `${agent.endpoint}\n${agent.model}\n${bound.root}\n${info.relative}\n${info.characters} characters`,
            buttons: [t('취소'), t('계속')], defaultId: 0, cancelId: 0 })).response === 1,
        });
        return await fileTask.apply({ ...bound, id: params.id }, async proposal => (await dialog.showMessageBox(window, {
          type: 'warning', title: t('파일 저장 승인'), message: t('검토한 수정안을 파일에 저장할까요?'),
          detail: `${bound.root}\n${proposal.path}\n${t('기존 파일이 있으면 교체됩니다. 명령은 실행하지 않습니다.')}`,
          buttons: [t('취소'), t('저장')], defaultId: 0, cancelId: 0,
        })).response === 1);
      } catch (error) {
        if (/^file_task_[a-z_]+$/.test(error.message) || error instanceof PersonalError || error.code === 'transmission_blocked') throw error;
        throw new Error('file_task_failed');
      } finally { personalDialogActive = false; }
    });
    team = new TeamCoordinator({ open: (id, { objective }) => {
      const service = agents.open(id);
      const state = service.state();
      if (state.mode !== 'personal' || !state.model || (state.connection !== 'codex' && !state.accountConfigured && state.provider !== 'local' && !state.keyConfigured)) throw new PersonalError('참여 에이전트의 모델 연결을 설정해 주세요.');
      const connection = state.connection === 'codex' ? new CodexConnection({ directory: agents.location(id), openExternal: url => shell.openExternal(url) }) : null;
      const snapshot = knowledge.snapshot(id, true);
      return { model: state.model, complete: messages => { const input = enrich(messages, snapshot, objective); return connection ? connection.complete(input, state.model, state.reasoningEffort || '') : service.complete(input); }, cancel: () => connection ? connection.cancel() : service.cancel(), close: () => connection?.stop() };
    } });
    for (const method of ['state', 'login', 'cancelLogin', 'logout', 'model']) ipcMain.handle(`btk:gemini:${method}`, async (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('Untrusted request');
      try {
        if (params?.agentId !== agents.data.selected || personal.data.connection !== 'gemini-cli') throw new PersonalError('대화의 에이전트가 변경되었습니다. 선택 상태를 확인해 주세요.');
        if (method === 'state') return geminiCli.state();
        personal.idle();
        if (conversations.active || team.active || personalDialogActive || codex.loginId || googleAccounts.pending) throw new PersonalError('진행 중인 요청을 먼저 중단해 주세요.');
        if (method === 'cancelLogin') return await geminiCli.cancelLogin();
        if (geminiCli.pending) throw new PersonalError('진행 중인 로그인을 완료하거나 취소해 주세요.');
        if (method === 'login') return geminiCli.login();
        if (method === 'model') return agents.state(personal.geminiModel(params.model));
        personalDialogActive = true;
        try {
          const answer = await dialog.showMessageBox(window, { type: 'warning', title: t('로그아웃'), buttons: [t('취소'), t('로그아웃')], defaultId: 0, cancelId: 0,
            message: t('공유 Gemini 계정에서 로그아웃할까요?'), detail: t('이 계정을 사용하는 모든 에이전트의 Gemini 연결이 해제됩니다.') });
          return answer.response === 1 ? await geminiCli.logout() : geminiCli.state();
        } finally { personalDialogActive = false; }
      } catch (error) { throw new Error(error instanceof PersonalError ? error.message : 'Gemini CLI 요청을 처리하지 못했습니다.'); }
    });
    const googleState = () => {
      const state = googleAccounts.state();
      return { ...state, accounts: state.accounts.map(account => ({ ...account, agents: agents.data.agents.filter(agent => {
        const data = (agent.id === agents.data.selected ? personal : agents.open(agent.id)).data;
        return data.connection === 'google' && data.googleAccountId === account.id;
      }).map(agent => ({ id: agent.id, name: agent.name })) })) };
    };
    for (const method of ['state', 'import', 'login', 'reopenLogin', 'cancelLogin', 'remove', 'model']) ipcMain.handle(`btk:google:${method}`, async (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('Untrusted request');
      try {
        if (params?.agentId !== agents.data.selected) throw new PersonalError('대화의 에이전트가 변경되었습니다. 선택 상태를 확인해 주세요.');
        if (method === 'state') return googleState();
        personal.idle();
        if (conversations.active || team.active || personalDialogActive || codex.loginId || geminiCli.pending) throw new PersonalError('진행 중인 요청을 먼저 중단해 주세요.');
        if (method === 'cancelLogin') { googleAccounts.cancelLogin(); return googleState(); }
        if (method === 'reopenLogin') { googleAccounts.reopenLogin(params.id); return googleState(); }
        if (googleAccounts.pending) throw new PersonalError('진행 중인 로그인을 완료하거나 취소해 주세요.');
        if (method === 'login') { await googleAccounts.login(params.id); return googleState(); }
        if (method === 'model') return agents.state(personal.googleModel(params));
        personalDialogActive = true;
        try {
          if (method === 'import') {
            const choice = await dialog.showOpenDialog(window, { properties: ['openFile'], filters: [{ name: 'Google OAuth JSON', extensions: ['json'] }] });
            if (choice.canceled) return googleState();
            const file = choice.filePaths[0]; const stat = fs.lstatSync(file);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32000) throw new PersonalError('Google 데스크톱 OAuth 클라이언트 JSON을 선택해 주세요.');
            googleAccounts.import(JSON.parse(fs.readFileSync(file, 'utf8')), params.name);
          } else {
            const account = googleState().accounts.find(a => a.id === params.id);
            if (!account) throw new PersonalError('연결 계정을 선택해 주세요.');
            const answer = await dialog.showMessageBox(window, { type: 'warning', title: t('연결 계정 삭제'), message: t('이 PC에서 공유 계정을 삭제할까요?'),
              detail: `${account.name}\n${account.agents.map(a => a.name).join(', ')}\n${t('연결된 에이전트는 다시 로그인하기 전까지 실행할 수 없습니다. Google 측 앱 권한은 별도로 철회해야 합니다.')}`,
              buttons: [t('취소'), t('삭제')], defaultId: 0, cancelId: 0 });
            if (answer.response === 1) googleAccounts.remove(params.id);
          }
          return googleState();
        } finally { personalDialogActive = false; }
      } catch (error) { throw new Error(error instanceof PersonalError ? error.message : 'Google 계정 요청을 처리하지 못했습니다.'); }
    });
    for (const method of ['read', 'prompt', 'save', 'remove']) ipcMain.handle(`btk:knowledge:${method}`, (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('Untrusted request');
      if (params?.agentId !== agents.data.selected) throw new PersonalError('대화의 에이전트가 변경되었습니다. 선택 상태를 확인해 주세요.');
      if (method === 'read') return knowledge.state(agents.data.selected);
      personal.idle();
      if (conversations.active || team.active || personalDialogActive || codex.loginId || googleAccounts.pending || geminiCli.pending) throw new PersonalError('진행 중인 요청을 먼저 중단해 주세요.');
      if (method === 'prompt') return knowledge.prompt(agents.data.selected, params.value);
      if (method === 'save') return knowledge.upsert(agents.data.selected, params.record);
      return knowledge.remove(agents.data.selected, params.id);
    });
    for (const method of ['state', 'start', 'cancel', 'clear', 'configuration', 'configure']) ipcMain.handle(`btk:team:${method}`, async (event, params) => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal.data.mode !== 'personal') throw new Error('Untrusted request');
      if (method === 'state') return team.state();
      if (method === 'configuration') return agents.teamState();
      if (method === 'cancel') return team.cancel();
      personal.idle();
      if (conversations.active || personalDialogActive || codex.loginId || googleAccounts.pending || geminiCli.pending) throw new PersonalError('진행 중인 요청을 먼저 중단해 주세요.');
      if (team.active) throw new PersonalError('팀 작업이 진행 중입니다.');
      if (method === 'clear') return team.clear();
      if (method === 'configure') return agents.configureTeam(params);
      const configuration = agents.teamState();
      const participants = [params?.masterId, ...(Array.isArray(params?.workerIds) ? params.workerIds : [])];
      if (participants.some(id => !configuration.agents.some(agent => agent.id === id && agent.configured))) throw new PersonalError('참여 에이전트의 모델 연결을 설정해 주세요.');
      personalDialogActive = true;
      try {
        const answer = await dialog.showMessageBox(window, { type: 'question', title: t('팀 작업 실행 확인'), buttons: [t('취소'), t('계속')], defaultId: 0, cancelId: 0, message: t('선택한 모델로 팀 작업을 실행할까요?'), detail: t('팀 대화의 최근 결과와 활성 메모리·역할 프롬프트가 참여 모델에 전달됩니다. 작업 결과는 마스터와 공유됩니다. 최대 6회 호출하며 API 요금 또는 구독 한도가 소비됩니다. 다른 개인 대화와 파일은 전송하지 않습니다.') });
        if (answer.response !== 1) return team.state();
      } finally { personalDialogActive = false; }
      return team.start(params, agents.data.agents);
    });
    for (const method of ["state", "agent_create", "agent_select", "agent_rename", "mode", "connection", "codex_state", "codex_login", "codex_cancelLogin", "codex_logout", "codex_models", "codex_limits", "codex_model", "save", "removeKey", "folder", "export", "exportImage", "copy", "test", "chat", "generateImage", "cancel", "slack_state", "slack_save", "slack_enable", "slack_remove", "slack_test", "slack_channels", "slack_cancel"]) {
      ipcMain.handle(`btk:personal:${method}`, async (event, params) => {
        if (!trustedFrame(event, window, entry)) throw new Error("신뢰할 수 없는 요청입니다.");
        if (personalFailure) throw new Error("개인용 보안 설정을 읽지 못했습니다. 저장 위치와 기존 설정을 확인해 주세요.");
        try {
          if (method === "state") return agents.state();
          if (conversations.active && !['agent_select', 'slack_state'].includes(method)) throw new PersonalError('다른 세션의 작업이 진행 중입니다. 완료 후 설정을 변경해 주세요.');
          if (googleAccounts.pending || geminiCli.pending) throw new PersonalError('진행 중인 로그인을 완료하거나 취소해 주세요.');
          if (team.active) throw new PersonalError('팀 작업이 진행 중입니다.');
          if (personalDialogActive) throw new PersonalError("열린 확인 창을 먼저 닫아 주세요.");
          if (method === "mode") {
            if (setupActive || bridge.pending.size) throw new PersonalError("진행 중인 작업을 먼저 완료해 주세요.");
            const state = personal.setMode(params?.mode);
            codex.stop();
            if (state.mode === "personal") bridge.stop();
            return agents.state(state);
          }
          if (personal.data.mode !== "personal") throw new PersonalError("개인용 모드를 선택해 주세요.");
          if (method.startsWith("agent_")) {
            personal.idle();
            if (codex.loginId) throw new PersonalError("진행 중인 로그인을 완료하거나 취소해 주세요.");
            if (method === "agent_rename") return agents.rename(params?.name);
            const state = method === "agent_create" ? agents.create(params?.name) : agents.select(params?.id);
            codex.stop();
            personal = agents.service;
            slack = new SlackConnector({ personal });
            codex = new CodexConnection({ directory: agents.location(state.agentId), openExternal: url => shell.openExternal(url) });
            return state;
          }
          if (method === "connection") { const state = personal.connection(params?.connection); codex.stop(); return agents.state(state); }
          if (method.startsWith("codex_")) {
            if (personal.data.connection !== "codex") throw new PersonalError("ChatGPT 로그인 연결을 선택해 주세요.");
            personal.idle();
            personal.codexActive = true;
            try {
            if (method === "codex_state") return await codex.state();
            if (method === "codex_cancelLogin") return await codex.cancelLogin();
            if (method === "codex_login") return await codex.login();
            if (method === "codex_logout") return await codex.logout();
            if (method === "codex_models") return await codex.models();
            if (method === "codex_limits") return await codex.limits();
            if (method === "codex_model") {
              const model = (await codex.models()).find(model => model.id === params?.model);
              if (!model) throw new PersonalError("사용 가능한 Codex 모델을 선택해 주세요.");
              if (!require('./codex-effort.cjs').supportsEffort(model, params.effort ?? '')) throw new PersonalError('이 모델에서 지원하지 않는 추론 강도입니다. 모델 설정을 다시 저장해 주세요.');
              personal.codexActive = false;
              return agents.state(personal.codexModel(params.model, params.effort ?? ''));
            }
            } finally { personal.codexActive = false; }
          }
          if (method === "slack_state") return slack.state();
          if (method === "slack_save") return slack.save(params?.token);
          if (method === "slack_enable") return slack.enable(params?.enabled);
          if (method === "slack_remove") return slack.remove();
          if (method === "slack_test") return await slack.call("auth.test");
          if (method === "slack_channels") return await slack.call("conversations.list", params?.cursor ?? "");
          if (method === "slack_cancel") return slack.cancel();
          if (method === "save") return agents.state(personal.save(params));
          if (method === "removeKey") return agents.state(personal.removeKey());
          if (method === "cancel") return personal.data.connection === "codex" ? codex.cancel() : personal.cancel();
          if (method === "folder") {
            personal.idle();
            personalDialogActive = true;
            try {
              const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
              return agents.state(selection.canceled ? personal.state() : personal.workspace(selection.filePaths[0]));
            } finally { personalDialogActive = false; }
          }
          if (method === 'export' || method === 'exportImage') {
            personal.idle();
            personalDialogActive = true;
            try {
              if (method === 'exportImage') { validateImage(params?.image, OUTPUT_LIMIT); return await exportImage(params, options => dialog.showSaveDialog(window, options)); }
              return await exportDocument(params, options => dialog.showSaveDialog(window, options));
            }
            finally { personalDialogActive = false; }
          }
          if (method === 'copy') {
            if (typeof params?.content !== 'string' || Buffer.byteLength(params.content) > 1024 * 1024) throw new PersonalError('복사할 내용을 확인해 주세요.');
            clipboard.writeText(params.content);
            return { copied: true };
          }
          if (method === "test") {
            personal.idle();
            personalDialogActive = true;
            let answer;
            try {
              answer = await dialog.showMessageBox(window, { type: "question", title: t("모델 연결 시험"), buttons: [t("취소"), t("시험")], defaultId: 0, cancelId: 0,
                message: t("저장된 모델로 시험 요청을 보낼까요?"), detail: personal.data.connection === 'gemini-cli' ? t('Gemini CLI 계정의 사용 한도가 소비됩니다. 작업 폴더는 전송하지 않습니다.') : personal.data.connection === "codex" ? t("ChatGPT 구독의 Codex 사용 한도가 소비됩니다. 작업 폴더는 전송하지 않습니다.") : `${personal.state().endpoint}\n${personal.state().model}\n${t("선택한 주소로 요청이 전송됩니다. 외부 공급자는 API 사용 요금이 발생할 수 있습니다. 작업 폴더는 전송하지 않습니다.")}` });
            } finally { personalDialogActive = false; }
            if (answer.response !== 1) throw new PersonalError("연결 시험을 취소했습니다.");
            const result = await complete([{ role: "user", content: "Reply with OK." }], { probe: true });
            return { status: result.status, usage: result.usage, checkedAt: result.checkedAt };
          }
          if (params?.agentId !== agents.data.selected) throw new PersonalError("대화의 에이전트가 변경되었습니다. 선택 상태를 확인해 주세요.");
          return await executeConversation({ ...params, output: method === 'generateImage' ? 'image' : 'chat' }, agents.state(), personal, complete);
        } catch (error) {
          throw new Error(error instanceof PersonalError ? error.message : "개인용 요청을 처리하지 못했습니다.");
        }
      });
    }
    session.defaultSession.setPermissionRequestHandler(
      (_contents, _permission, callback) => callback(false),
    );
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
      callback({ cancel: !bundledResource(request.url, path.resolve(__dirname, "../dist")) });
    });
    for (const method of METHODS) {
      ipcMain.handle(`btk:${method}`, async (event, params) => {
        if (!trustedFrame(event, window, entry))
          throw new Error("신뢰할 수 없는 요청입니다.");
        if (personalFailure || personal?.data.mode !== "enterprise") throw new Error("조직용 기능은 정상 설정된 조직 연결 모드에서만 사용할 수 있습니다.");
        if (["setup_enroll", "setup_install", "agent_start"].includes(method)) {
          if (setupActive) throw new Error("설치 작업을 진행 중입니다.");
          setupActive = true;
          try {
            const answer = await dialog.showMessageBox(window, {
              type: "question", buttons: [t("취소"), t("계속")], defaultId: 0, cancelId: 0,
              title: t("AEGIS Agent Ops 설치 확인"),
              message: method === "agent_start" ? t("설치된 에이전트를 백그라운드에서 시작할까요?") : method === "setup_enroll" ? t("이 PC를 중앙 프로파일에 연결할까요?") : t("필수 도구와 운영 서비스를 설치할까요?"),
              detail: method === "setup_enroll" ? t("등록 코드는 중앙 인증에만 사용됩니다. 기존 러너 신원은 바꾸지 않습니다.")
                : method === "agent_start" ? t("현재 프로파일의 검증된 런타임만 시작합니다. 창을 닫아도 실행은 유지되며 기존 운영 서비스가 있으면 중복 시작하지 않습니다.")
                : t("공식 배포 번들과 필요한 외부 도구를 내려받습니다. 모델 인증과 Windows 권한 승인이 필요할 수 있습니다. 선택한 경우 서비스 시작 및 로그인 시 자동시작을 등록합니다."),
            });
            if (answer.response !== 1) throw new Error("사용자가 취소했습니다.");
            const result = await bridge.call(method, params);
            if (method === "setup_install" && result.status === "running") {
              setupMonitor = setInterval(async () => {
                try {
                  if ((await bridge.call("setup_status")).status !== "running") {
                    setupActive = false; clearInterval(setupMonitor);
                  }
                } catch { setupActive = false; clearInterval(setupMonitor); }
              }, 1500);
            } else setupActive = false;
            return result;
          } catch (error) { setupActive = false; throw error; }
        }
        return bridge.call(method, params);
      });
    }
    updates = new DesktopUpdates({
      updater: require('electron-updater').autoUpdater, version: app.getVersion(),
      enabled: app.isPackaged && process.platform === 'win32',
      assertIdle: () => {
        personal?.idle();
        if (conversations.active || personalFailure || personal?.data.mode !== 'personal' || setupActive || bridge.pending.size || team?.active || personalDialogActive || codex?.loginId || googleAccounts?.pending || geminiCli?.pending) throw new Error(t('진행 중인 작업이나 로그인을 먼저 완료해 주세요.'));
      },
      confirmInstall: async () => {
        personalDialogActive = true;
        try {
          const answer = await dialog.showMessageBox(window, { type: 'warning', title: t('업데이트 설치'),
            message: t('앱을 종료하고 업데이트를 설치할까요?'),
            detail: t('저장하지 않은 대화는 사라집니다. 현재 설치 파일은 코드 서명되지 않았습니다. Windows 보안 경고가 표시될 수 있습니다.'),
            buttons: [t('취소'), t('재시작 및 설치')], defaultId: 0, cancelId: 0 });
          return answer.response === 1;
        } finally { personalDialogActive = false; }
      },
    });
    updates.on('change', state => { if (window && !window.isDestroyed()) window.webContents.send('btk:updates:changed', state); });
    for (const method of ['state', 'check', 'download', 'install']) ipcMain.handle(`btk:updates:${method}`, async event => {
      if (!trustedFrame(event, window, entry) || personalFailure || personal?.data.mode !== 'personal') throw new Error('Untrusted request');
      if (method === 'state' && !isolatedUserData) updates.start();
      return updates[method]();
    });
    window = new BrowserWindow({
      title: "AZWOL Personal",
      icon: path.join(__dirname, '../branding/azwol.ico'),
      width: 1360,
      height: 900,
      minWidth: 760,
      minHeight: 600,
      backgroundColor: "#f6f7f8",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
      },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) conversations.cancelAll(); });
    window.webContents.on('render-process-gone', () => conversations.cancelAll());
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-attach-webview", (event) =>
      event.preventDefault(),
    );
    bridge.on("chat", (data) => {
      if (!window.isDestroyed())
        window.webContents.send("btk:chat-event", data);
    });
    bridge.on("disconnected", () => {
      if (!window.isDestroyed()) window.webContents.send("btk:disconnected");
    });
    window.loadURL(entry);
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (setupActive) { event.preventDefault(); return; }
    clearInterval(setupMonitor);
    updates?.stop();
    conversations.cancelAll(true);
    personal?.cancel();
    team?.cancel();
    googleAccounts?.stop();
    geminiCli?.stop();
    codex?.stop();
    slack?.cancel();
    bridge.stop();
  });
  app.on("browser-window-created", (_event, created) => {
    created.on("close", (event) => {
      if (setupActive) {
        event.preventDefault();
        dialog.showMessageBox(created, { type: "info", message: t("설치가 진행 중입니다."), detail: t("완료 또는 실패 결과를 확인한 뒤 닫을 수 있습니다.") });
      }
    });
  });
}

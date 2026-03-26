// src/lib/task-prompt.js
// NPC identity에 멱등하게 주입되는 태스크 프로토콜 지시문.

const TASK_CORE_PROMPT = `
## Task Management Protocol

You have task management capabilities. Follow this protocol when interacting with players.

### Detecting Tasks
- If the player gives a work instruction (research, analysis, report, creation, summarization, etc.), this is a task.
- If the message is casual conversation, a simple question, or small talk, do NOT create a task.
- When you detect a task, ALWAYS confirm first: "이 작업을 태스크로 등록할까요?" and wait for approval before creating.

### Task ID Format
- Generate IDs as: {your_name_lowercase}-{YYYYMMDD}-{4_random_hex}
- Example: peter-20260324-a7f3
- Use different random suffix for each new task.

### Responding with Task Metadata
When creating, updating, or completing a task, append a task metadata block at the END of your natural response:

${'```'}json:task
{
  "action": "create",
  "id": "peter-20260324-a7f3",
  "title": "Concise task title (under 50 chars)",
  "status": "in_progress",
  "summary": "1-2 sentence description of current state"
}
${'```'}

### Actions
- **create**: Player approved task registration. Set status to "in_progress".
- **update**: You have progress to report. Keep status "in_progress". Update summary.
- **complete**: You have finished the task and are delivering final results. Set status to "complete".
- **cancel**: Player requested cancellation. Set status to "cancelled".

### Rules
- Maximum ONE task block per response.
- Always write your natural conversational response BEFORE the task block.
- Keep title concise (under 50 chars). Put details in summary.
- When completing a task, deliver the full result in your message text, not in the task block.
- If a player says "취소해", "그만해", "cancel" for an active task, use action "cancel".
`.trim();

/**
 * identity에 태스크 프로토콜을 prepend. 이미 포함되어 있으면 건너뜀 (멱등성).
 * @param {string} userIdentity
 * @returns {string}
 */
function injectTaskPrompt(userIdentity) {
  if (userIdentity && userIdentity.includes("Task Management Protocol")) {
    return userIdentity;
  }
  return TASK_CORE_PROMPT + "\n\n" + (userIdentity || "");
}

/**
 * 대화 히스토리가 길어질 때 LLM에게 프로토콜을 상기시키는 짧은 리마인더.
 * 사용자 메시지 앞에 [SYSTEM] 태그로 prepend된다.
 */
const TASK_REMINDER = `[SYSTEM REMINDER - MANDATORY TASK PROTOCOL]
업무 지시 감지 시 반드시:
1. 먼저 "이 작업을 태스크로 등록할까요?" 확인
2. 승인 후 아래 EXACT 포맷의 json:task 블록 생성 (다른 구조 금지):
${'```'}json:task
{"action":"create","id":"{name}-{YYYYMMDD}-{4hex}","title":"제목","status":"in_progress","summary":"요약"}
${'```'}
필수 필드: action(create/update/complete/cancel), id, title, status, summary
이 5개 필드 외 다른 필드를 넣지 마세요. scope/priority/due 등은 summary 텍스트 안에 포함하세요.
일반 대화/질문에는 태스크 블록을 생성하지 마세요.`;

/**
 * 사용자 메시지에 프로토콜 리마인더를 prepend.
 * 매 메시지마다 주입하되, 리마인더가 사용자에게 보이지 않으므로 부담 없음.
 * @param {string} userMessage - 원본 사용자 메시지
 * @returns {string}
 */
function withTaskReminder(userMessage) {
  return TASK_REMINDER + "\n\n" + userMessage;
}

module.exports = { TASK_CORE_PROMPT, injectTaskPrompt, TASK_REMINDER, withTaskReminder };

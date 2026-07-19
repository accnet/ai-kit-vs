# ADR-0001: AI-Kit V3 — Provider-Agnostic Orchestrator (Runtime Split, Agents & Skills Retained)

**Status:** Accepted
**Date:** 2026-07-19
**Deciders:** Repo owner / AI-Kit maintainer

> Naming decision: the product keeps the name **ai-kit** and is released as
> **version 1.0.0** (no "V3" rename). All config carries `version: 1.0.0`
> (`package.json`, `.ai/ai-kit.json`, `.ai/kit.yaml`) and `ai-kit version`
> reports it.

## Context

AI-Kit V2 (bản hiện tại trong repo) đã là một orchestrator đa-agent chạy được:
runtime TypeScript trong `.ai/node/`, state machine + claim/lease (`engine.ts`,
`board.ts`), artifact có schema zod (`artifacts.ts`), plugin planner/executor/
reviewer (`run-plugin.ts`, `.ai/plugins/`), provider map (`models.yaml`), state
trong `.ai-work/`, event log, worktree và gate-runner. Toàn bộ giao tiếp giữa các
thành phần đã đi qua artifact JSON.

Đề xuất V3 muốn đẩy kiến trúc này tới đích cuối: một orchestrator **độc lập**,
không khoá vào Claude, Codex, VS Code hay một model cụ thể. LLM và coding agent
chỉ là **provider/plugin có thể thay thế**; VS Code chỉ là UI; `.ai-work/` là
nguồn dữ liệu duy nhất của dự án.

Các lực chi phối:

- Muốn nhẹ, dễ mở rộng, dễ thay model — nhưng vẫn giữ chất lượng output.
- Muốn tách UI (VS Code) khỏi logic điều phối.
- Muốn state của dự án nằm trong repo để chia sẻ và tái tạo.
- ~70% ý tưởng V3 đã tồn tại trong V2 → rủi ro lớn nhất là "viết lại" thay vì
  tiến hoá, làm mất lớp tri thức đã tuyển chọn.

Hai quyết định đã chốt với chủ repo:

1. **KHÔNG bỏ Agents và Skills.** Chúng là lớp tri thức tuyển chọn tạo ra chất
   lượng, và AGENTS.md V2 quy định các hợp đồng này phải ổn định.
2. Đặt tên phiên bản là **V3** (không phải "V1"), vì đây là bản kế thừa V2.

## Decision

Chuyển sang **V3 theo hướng tiến hoá, không viết lại**:

1. **Giữ nguyên các hợp đồng V2 ổn định**: `.ai/agents/<role>/` (6 tài liệu),
   `.ai/skills/<domain>/<tech>/` (tri thức tuyển chọn), `.ai/workflows/<intent>/`,
   `.ai-work/`. Agents = định nghĩa vai trò; Skills = tri thức domain nạp theo
   `route`. Đây là "bộ não" và được giữ nguyên.

2. **Tách rõ 3 tầng** (đa phần đã có, chỉ chuẩn hoá ranh giới):
   - **Core Runtime / Orchestrator**: workflow, queue/claim, state, context,
     artifact, plugin manager, dashboard-data, adapter. Không chứa logic AI.
   - **Capability Plugins**: `planner / executor / reviewer` (đã có) **cộng thêm**
     họ plugin tri thức `knowledge / framework / language / tool` — chính là nơi
     Agents + Skills được đóng gói và version-hoá, KHÔNG thay thế chúng.
   - **Model Providers**: `models.yaml` map role → provider (claude/codex/qwen/…),
     đứng sau một **Provider Adapter** chuẩn hoá I/O.

3. **VS Code Extension chỉ là UI**: gọi Core Runtime qua CLI (mọi lệnh đã in JSON
   ra stdout). Không nhúng logic AI.

4. **Client bên ngoài không thuộc runtime**: mọi UI gọi CLI và artifact contract;
   runtime không nhúng network transport.

5. **Global vs Project** với chính sách tái tạo rõ ràng:
   - `~/.ai-kit/` chứa runtime + plugin dùng chung (nhẹ repo).
   - `.ai-work/` là state riêng của dự án.
   - Để không phá vỡ tính tái tạo, **pin version** runtime/plugin trong một
     lockfile cam kết vào repo (xem Action Items).

## Options Considered

### Option A: Giữ nguyên V2 monolithic (mọi thứ nhúng trong repo)
| Dimension | Assessment |
|-----------|------------|
| Complexity | Low |
| Cost | Low |
| Scalability | Med — khó chia sẻ runtime giữa nhiều repo |
| Team familiarity | High — là bản đang chạy |

**Pros:** Tái tạo tuyệt đối (mọi thứ trong repo); không có tầng global.
**Cons:** Trùng lặp runtime ở mọi dự án; UI chưa tách; nâng cấp thủ công.

### Option B: Viết lại, bỏ Agents & Skills, chỉ còn "Capability Plugin" phẳng
| Dimension | Assessment |
|-----------|------------|
| Complexity | High |
| Cost | High |
| Scalability | High trên giấy |
| Team familiarity | Low — mất hợp đồng quen thuộc |

**Pros:** Mô hình gọn về mặt sơ đồ.
**Cons:** **Mất lớp tri thức tuyển chọn** (giá trị cốt lõi); vi phạm hợp đồng ổn
định của AGENTS.md; rủi ro rewrite; không có đường di trú. → **Bị loại.**

### Option C (Chosen): Tiến hoá — tách runtime/UI/provider, GIỮ Agents & Skills
| Dimension | Assessment |
|-----------|------------|
| Complexity | Med |
| Cost | Med |
| Scalability | High — runtime dùng chung, provider thay thế được |
| Team familiarity | High — kế thừa V2 |

**Pros:** Tận dụng ~70% đã có; giữ chất lượng từ skills; ranh giới UI/logic/provider
sạch; provider thay thế được.
**Cons:** Phải định nghĩa chặt 3 hợp đồng (adapter, plugin manifest, reproducibility);
tầng global thêm phần quản lý version.

## Trade-off Analysis

Điểm đánh đổi trung tâm là **global runtime ↔ tái tạo**. Sức mạnh của V2 là mọi thứ
nằm trong repo nên tái tạo được. Đưa runtime/plugin ra `~/.ai-kit/` làm nhẹ repo và
cho phép dùng chung, nhưng nếu không pin version thì hai máy khác version plugin sẽ
cho hành vi khác → lời hứa "reproducible" thành sai. Giải pháp: lockfile per-project.

Đánh đổi thứ hai là **trung thực về "reproducible"**: ta tái tạo được *state,
artifact, workflow, và bằng chứng*, nhưng **không** tái tạo được output của model
(LLM non-deterministic, model đổi theo thời gian). ADR này cố ý phát biểu phạm vi
tái tạo là "quy trình và bằng chứng", không phải "kết quả model".

Đánh đổi thứ ba: phần khó thật không nằm ở sơ đồ mà ở **Provider Adapter** — chuẩn
hoá I/O giữa các CLI/agent rất khác nhau (Claude, Codex, Qwen, Gemini). Đây phải là
hợp đồng được đặc tả rõ nhất, không phải phần phụ.

## Consequences

**Dễ hơn:**
- Thay model bằng cách sửa `models.yaml`, không đụng runtime.
- Xây UI (VS Code) như client mỏng gọi CLI JSON đã ổn định.
- Dùng lại một runtime cho nhiều repo.

**Khó hơn / cần cẩn trọng:**
- Quản lý version plugin global để giữ tái tạo (thêm lockfile + `doctor`).
- Bảo mật: plugin chạy lệnh CLI tuỳ ý (`spawnSync`) → cần allowlist, sandbox, quản
  lý secret của provider. Đây là rủi ro lớn nhất khi "provider thay thế được".
- Đặc tả và giữ ổn định hợp đồng Provider Adapter khi thêm provider mới.

**Cần xem lại về sau:**
- Cost/token budget thành cơ chế thực thi (đã có module token-budget).
- Human-in-the-loop gate (duyệt plan trước execute, duyệt trước merge).
- Retry/dead-letter cho executor lỗi (hiện mới có `reportBlocked`).
- Versioning schema artifact khi provider đổi định dạng.

## Action Items

1. [x] **Provider Adapter contract** — `provider-adapter.ts` +
       `.ai/engine/provider-adapter.md`: outcome chuẩn hoá, timeout, retry;
       `run-plugin` dùng adapter. (Còn lại: streaming nếu cần.)
2. [x] **Capability/Knowledge plugin manifest** — `.ai/node/capabilities.ts` +
       `.ai/capabilities/*.json` tham chiếu Agents + Skills **không thay đổi** cấu
       trúc; lệnh `capabilities`. (Còn lại: tích hợp vào `route` nếu cần.)
3. [x] **Reproducibility policy** — `lockfile.ts` + `.ai/ai-kit.lock.json`; lệnh
       `lock`/`verify-lock` pin runtime + hash plugin/capability/config.
4. [x] **Global/Project layout** — `home.ts` + lệnh `home --init`; `loadPlugin`
       ưu tiên project rồi fallback `~/.ai-kit/`.
5. [x] **Security hardening** — `.ai/security.yaml` + `security.ts` allowlist lệnh,
       enforce tại `loadPlugin`. (Còn lại: sandbox, quản lý secret provider.)
6. [x] **VS Code extension** — `extension/` client mỏng gọi CLI, ngoài build repo.
7. [x] **CLI boundary** — runtime chỉ expose CLI và artifact contract; không
       nhúng network transport.
8. [x] **Versioning** — giữ tên `ai-kit`, phát hành `1.0.0`; AGENTS.md nêu rõ
       Agents & Skills được giữ và liệt kê lệnh runtime mới.

## Notes

- Đây là bản tiến hoá của V2, **không viết lại**. Giữ nguyên `.ai/agents`,
  `.ai/skills`, `.ai/workflows`, `.ai-work`.
- Phạm vi "reproducible" = quy trình + artifact + bằng chứng (không phải output model).

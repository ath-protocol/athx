# ATHX — ATH协议无头CLI客户端

[English](./README.en.md)

> ⚡ ATH可信生态系统的命令行客户端，用于代理注册、授权、令牌交换和API代理访问

## 🎯 项目简介

ATHX是[ATH可信代理握手协议](https://github.com/ath-protocol/agent-trust-handshake-protocol) v0.1的TypeScript CLI客户端实现，支持网关模式和原生模式。它包含完整的ATH协议SDK（`@ath-protocol/types`、`@ath-protocol/client`、`@ath-protocol/server`），以及[zero-review](https://github.com/A7um/zero-review)自动化开发技能插件。

ATHX负责处理完整的可信握手流程：代理身份认证（ES256 JWT证明）、两阶段授权（应用侧注册 + 用户侧OAuth/PKCE）、令牌交换（含三方权限范围交集计算）和受保护API访问。

## ✨ 核心能力

### 🔐 代理身份认证
- ES256 JWT代理证明的签发与验证
- 代理身份文档的自动获取与公钥提取
- JTI重放保护，防止证明重用
- `iat`时间窗口校验（5分钟内）

### 🤝 两阶段可信握手
- **阶段A（应用侧授权）**：代理注册、权限范围审批、客户端凭证颁发
- **阶段B（用户侧授权）**：OAuth授权、PKCE S256强制启用、用户同意流程
- 会话管理（单次使用，10分钟超时）
- 重定向URI精确匹配验证

### 🎫 令牌管理
- ATH访问令牌的生成、验证、吊销
- 令牌绑定：`(agent_id, user_id, provider_id, scopes)`
- 权限范围交集计算：`有效范围 = 代理已批准 ∩ 用户已同意 ∩ 请求的范围`
- 空交集时拒绝签发令牌（403）

### 🚦 网关代理
- `ANY /ath/proxy/{provider_id}/{path}` — 令牌验证与上游转发
- `X-ATH-Agent-ID` 头校验（必须与令牌绑定的agent_id匹配）
- 上游服务商OAuth令牌绝不暴露给代理
- 逐跳头和ATH特有头在转发前被剥离

### 📝 服务发现
- 网关模式：`GET /.well-known/ath.json` — 列出可用服务商和权限范围
- 原生模式：`GET /.well-known/ath-app.json` — 服务端点和OAuth配置

## 📦 安装方式

### npm安装
```bash
npm install -g athx
```

### 源码安装
```bash
git clone https://github.com/ath-protocol/athx.git
cd athx
pnpm install
pnpm run build
```

## 🚀 快速开始

### 第一步：发现可用服务商
```bash
# 网关模式
athx discover --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json

# 原生模式
athx discover --mode native --service https://api.example.com --agent-id https://my-agent.example.com/.well-known/agent.json
```

### 第二步：注册代理（阶段A）
```bash
athx register --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  --provider github --scopes repo,read:user --purpose "代码审查助手"
```

### 第三步：授权用户（阶段B）
```bash
athx authorize --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  --provider github --scopes repo,read:user
# 输出包含授权URL，在浏览器中打开完成OAuth同意
```

### 第四步：令牌交换
```bash
athx token --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  --code <授权码> --session <会话ID>
```

### 第五步：访问API
```bash
athx proxy --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  github GET /user/repos
```

### 第六步：吊销令牌
```bash
athx revoke --gateway https://gateway.example.com --agent-id https://my-agent.example.com/.well-known/agent.json \
  --provider github
```

## 🏗️ 项目架构
```
┌─────────────────┐
│   athx CLI      │  命令行客户端（discover, register, authorize, token, proxy, revoke, status, config）
├─────────────────┤
│ ATHXGatewayClient │  网关模式 — 通过ATH网关代理请求
│ ATHXNativeClient  │  原生模式 — 直接连接ATH原生服务
├─────────────────┤
│ @ath-protocol/  │
│   client        │  ATH客户端SDK（证明签发、注册、授权、令牌交换、代理）
│   server        │  ATH服务端SDK（处理器、代理、令牌验证、权限范围交集）
│   types         │  ATH协议类型定义（从JSON Schema自动生成）
├─────────────────┤
│ zero-review/    │  自动化开发技能插件（auto-dev, auto-test, auto-req, auto-triage）
└─────────────────┘
```

### ATH协议端点

| 端点 | 方法 | 路径 |
|------|------|------|
| 网关发现 | GET | `/.well-known/ath.json` |
| 服务发现 | GET | `/.well-known/ath-app.json` |
| 代理注册 | POST | `/ath/agents/register` |
| 发起授权 | POST | `/ath/authorize` |
| OAuth回调 | GET | `/ath/callback` |
| 令牌交换 | POST | `/ath/token` |
| API代理 | ANY | `/ath/proxy/{provider_id}/{path}` |
| 令牌吊销 | POST | `/ath/revoke` |

## 🎯 适用人群
- 🤖 AI代理开发者
- 🔐 安全工程师
- 🏗️ 系统架构师
- 👷‍♂️ 平台运维工程师

## 📖 文档资源
- [ATH协议规范 v0.1](https://github.com/ath-protocol/agent-trust-handshake-protocol/tree/main/specification/0.1)
- [TypeScript SDK文档](https://github.com/ath-protocol/typescript-sdk)
- [ATH协议官网](https://athprotocol.dev)
- [zero-review技能插件](https://github.com/A7um/zero-review)

## 🧪 测试

```bash
pnpm install
pnpm run build
pnpm run test    # 62项测试（36项单元测试 + 26项E2E测试）
```

E2E测试遵循auto-test `ath-protocol`测试角色，仅模拟外部OAuth服务商。所有ATH协议逻辑均通过真实HTTP请求进行测试：网关处理器、代理验证、令牌绑定、PKCE、权限范围交集和会话管理。

## 📄 开源协议
本项目采用 **MIT License** 开源协议，具体条款请查看LICENSE文件。

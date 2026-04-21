# ATHX 核心引擎
> ⚡ ATH可信生态系统的"大脑"，负责处理所有可信握手和认证逻辑
## 🎯 项目简介
ATHX是ATH可信代理握手协议的核心实现引擎，是整个ATH生态系统的心脏和大脑，负责处理所有的身份认证、握手请求、权限决策、令牌管理和存证审计工作。
ATHX是专门为高并发场景设计的，单实例可以支持每秒处理上万次握手请求，支持分布式部署，满足企业级应用的性能需求。
## ✨ 核心能力
### 🔐 身份认证管理
- 管理所有AI代理和服务的身份信息
- 支持身份证书的颁发、吊销、更新
- 支持跨机构身份互认
### 🤝 握手请求处理
- 处理所有AI代理的握手请求
- 自动完成双向身份验证
- 支持自定义握手流程和审批逻辑
### 🎫 令牌管理
- 访问令牌的生成、验证、刷新、吊销
- 支持多种令牌格式（JWT、PASETO等）
- 令牌生命周期自动管理
### 📝 存证审计
- 所有操作的加密存证，不可篡改
- 完整的审计日志，支持追溯
- 提供标准化的审计查询接口
### 🚦 权限决策
- 智能权限决策引擎，支持复杂权限规则
- 支持基于角色的权限控制（RBAC）
- 支持动态权限调整
## 📦 安装方式
### 二进制安装（推荐）
直接下载对应平台的二进制文件：
```bash
# Linux
wget https://github.com/ath-protocol/athx/releases/latest/download/athx-linux-amd64
# macOS
wget https://github.com/ath-protocol/athx/releases/latest/download/athx-darwin-amd64
# Windows
wget https://github.com/ath-protocol/athx/releases/latest/download/athx-windows-amd64.exe
```
### Docker安装
```bash
docker run -d -p 8080:8080 -v ./config:/etc/athx athprotocol/athx:latest
```
### 源码编译
```bash
git clone https://github.com/ath-protocol/athx.git
cd athx
make build
```
## 🚀 快速开始
### 第一步：准备配置文件
创建`config.yaml`文件：
```yaml
server:
  port: 8080
  admin_token: "your-admin-token"  # 管理后台的Token
database:
  type: "sqlite"  # 支持sqlite、mysql、postgresql
  path: "./athx.db"
crypto:
  signing_key: "your-signing-key"  # 令牌签名密钥
  encryption_key: "your-encryption-key"  # 数据加密密钥
```
### 第二步：启动ATHX引擎
```bash
./athx start --config config.yaml
```
### 第三步：验证服务
```bash
curl http://localhost:8080/health
# 正常返回：{"status": "ok", "version": "x.x.x"}
```
## 🏗️ 部署架构
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   AI代理    │ →   │  ATH网关    │ →   │   ATHX引擎  │
└─────────────┘     └─────────────┘     └─────────────┘
                                                 ↓
                                         ┌─────────────┐
                                         │   数据库    │
                                         └─────────────┘
```
ATHX可以独立部署，也可以和网关服务部署在一起，支持水平扩展，满足不同规模的业务需求。
## 🎯 适用人群
- 👷‍♂️ 运维工程师
- 🏗️ 系统架构师
- 🔐 安全工程师
- 🏢 企业IT管理人员
## 📖 文档资源
- [部署指南](https://athprotocol.dev/docs/athx/deployment)
- [配置参考](https://athprotocol.dev/docs/athx/configuration)
- [API文档](https://athprotocol.dev/docs/athx/api)
- [高可用部署方案](https://athprotocol.dev/docs/athx/high-availability)
## 📄 开源协议
本项目采用 **OpenATH License** 开源协议，具体条款请查看LICENSE文件。

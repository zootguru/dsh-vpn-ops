# dsh-vpn-ops

面向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的
WireGuard 与 VLESS Reality 安全运维插件。

它不是让模型自由执行 SSH。模型只能选择配置中预先允许的 `targetId` 和
`clientId`，不能传入任意主机、凭据、路径、下载地址或 shell 命令。

核心安全边界：

- 默认禁止远程变更和客户端密钥导出；
- SSH 强制校验 host key，只允许公钥认证；
- `vpn_apply` 必须使用未过期、配置未变化、远端基线未变化的 plan；
- apply 前先备份，失败自动恢复；
- 客户端私密内容不进入工具返回值，只能显式导出到本机 `0600` 文件；
- npm 包没有安装生命周期脚本。

## 工具

- `vpn_targets`：列出目标和客户端 ID，不返回主机或密钥。
- `vpn_preflight`：检查系统、权限、依赖和 SSH 策略。
- `vpn_status`：读取服务、端口、peer、握手、部署和备份状态。
- `vpn_plan`：生成短时有效、非敏感、绑定当前基线的计划。
- `vpn_apply`：按计划原子部署，并验证结果。
- `vpn_verify`：检查配置、服务、监听端口和握手证据。
- `vpn_rollback`：恢复 apply 创建的指定备份。
- `vpn_export_client`：将客户端配置写入本机私密文件，不回显内容。

## 安装

```sh
dsh plugin --profile my-profile add github:zootguru/dsh-vpn-ops#v0.1.0
```

完整配置、前置条件、限制、操作顺序和兼容性证据请以英文
[README](README.md) 为准。启用 `allowMutations` 前必须阅读
[威胁模型](docs/THREAT_MODEL.md)。

当前兼容性锁定 DSH `0.1.1-rc.2`。DSH 仍处于开发预览阶段，升级前应在
独立 profile 和测试服务器上重新执行 [验证流程](docs/VERIFICATION.md)。

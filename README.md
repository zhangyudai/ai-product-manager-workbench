# 产品经理 AI 工作台

**以项目为中心，管理产品资料，并通过 AI 完成需求分析、用户确认和结构化 PRD。**

> 当前状态：技术底座已经完成本地构建与启动验证，产品经理专属前端和完整业务闭环仍在开发中。仓库当前界面仍保留较多 AionUi 通用工作台能力，不代表 V1.0 最终界面。

## 产品目标

V1.0 面向独立产品经理和中小团队产品负责人，重点解决两件事：

1. 将访谈记录、会议纪要、竞品资料和历史需求统一放在项目中管理；
2. 从产品想法、现有资料或业务需求出发，经过 AI 分析和用户确认，生成可继续维护的结构化 PRD。

完整范围、业务规则和验收标准见 [PRD](docs/PRD.md)。

## 计划中的日常工作流程

以下内容是产品目标，尚未全部完成：

1. 创建或进入一个产品项目；
2. 选择“产品想法”“现有资料”或“业务需求”作为起点；
3. 上传并管理项目资料，包括 Word 文档；
4. 由需求与 PRD 助手梳理目标用户、使用场景、痛点、核心需求和 MVP 范围；
5. 用户确认关键信息，避免 AI 将推测写成事实；
6. 生成、编辑并保存结构化 PRD、用户故事和验收标准。

模型、助手和执行器属于任务执行配置，不替代上述产品业务流程。

## 当前进度

已经完成：

- 导入并固定 AionUi 与 AionCore 源码基线；
- 在 Windows 上完成 Rust、C++ Build Tools 和前端依赖环境；
- 验证 AionCore 构建、核心测试和 AionUi 桌面启动；
- 建立产品经理工作台 PRD、技术适配声明和开发进度记录；
- 建立代码改动全量检查、纯文档改动轻量检查的推送规则。

接下来开发：

- 产品经理工作台首页和导航；
- 项目工作区及项目资料管理；
- 产品想法、现有资料、业务需求三种入口；
- 需求分析、用户确认和 PRD 生成主流程；
- Word `.docx` 解析及真实模型接入冒烟验证。

详细进展和已知差距见 [开发进度](docs/进度.md)。

## 技术基础

| 部分 | 技术与职责 |
| --- | --- |
| AionUi | Electron + React，提供桌面窗口、前端界面和现有交互基础 |
| AionCore | Rust + Axum，提供本地后端、Agent、项目、文件和会话能力 |
| 数据 | SQLite + 本地文件存储 |
| 产品文档 | PRD、技术适配声明、开发进度和归属记录 |

本项目采用增量二次开发：优先复用已经验证的通用能力，只为产品经理业务闭环新增或调整必要模块。

## 项目结构

```text
product-manager-workbench/
├── AionUi/       # Electron 桌面端、React 前端和前端测试
├── AionCore/     # Rust 本地后端、接口和核心测试
├── docs/         # PRD、技术声明、开发进度和归属记录
├── LICENSE       # Apache License 2.0
├── NOTICE        # 上游、继承代码与当前分发版本的归属说明
└── README.md     # 当前项目说明
```

请保持 `AionUi` 与 `AionCore` 为同级目录。开发入口包括：

- [AionUi 开发说明](AionUi/readme.md)
- [AionCore 架构说明](AionCore/ARCHITECTURE.zh-CN.md)
- [技术适配声明](docs/技术适配声明.md)
- [修改记录](docs/MODIFICATIONS.md)

仓库不包含个人模型密钥、账号凭据、聊天记录、安装后的依赖或编译缓存。

## 维护与反馈

当前项目由 [GitHub @zhangyudai](https://github.com/zhangyudai) 维护。

问题和建议请提交至 [GitHub Issues](https://github.com/zhangyudai/ai-product-manager-workbench/issues)。请勿在反馈中附带密钥、账号凭据或私人会话内容。

## 开源来源与版权

本项目基于 [AionUi](https://github.com/iOfficeAI/AionUi) 与 [AionCore](https://github.com/iOfficeAI/AionCore) 进行二次开发，感谢上游作者和贡献者。

上游代码、继承修改和第三方材料的版权归各自权利人所有。本仓库保留适用的许可证、源文件版权头和归属记录；当前项目新增或修改内容同样按照仓库适用许可证提供。产品名称和展示不代表获得上游官方背书或第三方商标授权。

详见 [LICENSE](LICENSE)、[NOTICE](NOTICE)、[作者与归属](docs/AUTHORS.md)、[AionUi/LICENSE](AionUi/LICENSE) 和 [AionCore/LICENSE](AionCore/LICENSE)。

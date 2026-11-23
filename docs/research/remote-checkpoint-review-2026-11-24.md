# 固定检查点双轴复核

对比：`cee163b8208dfc3849f017dde1587a3393eb4a05..3771b973a1ab2033a63712a217e6455adf05362f`。标准轴和规格轴由独立代理读取固定 Git 对象复核；以下修复位于后续工作树，尚不据此声明全部交付验收通过。

## Standards

- 硬违背：0；非阻断气味：1，最高 P3。
- 四个 effect 模块重复业务结果解包表达式，属于可维护性提示。没有发现其当前行为不一致导致的功能错误，本轮未为此重构业务路径。

## Spec

- 发现：2，最高 P2；范围越界：0。
- Git 合法 `commit.cleanup` 可能改变 `git commit -m` 实际消息，原验收器按原始字符串比较，会将已提交误判 unknown。修复使用固定只读 `git stripspace` 与实际 cleanup/comment 配置计算期望消息，保留原提交参数。真实 Git 的默认、whitespace、strip、自定义/auto comment、verbatim/scissors、错误配置和伪消息回包均已覆盖；29项 Git effects 检查通过。
- `deck_current_project` 在二次解析时若 A 变为 B，原诊断分支可能把 B 数据缓存到 A 范围。v4 冻结 overlay 在该分支同样检查本机绑定项目/thread。真实假 Codex DB 切换、原 stdio、执行 journal 复现并验证：缓存只保留拒绝，不含 B；切回 A 后新请求正确。包含本地目录和可信 tracker 拒绝的3项独立回归通过。

## 验证边界

根代理复跑56项检查时，53项通过，3项因默认沙箱禁止测试夹具创建 Windows junction 而失败。保留原负例强度，改在相同隔离 scratch 路径执行获准的测试：Markdown 11/11、项目诊断3/3、显式本地目录4/4均通过，无 skip。并未把权限错误计为已通过，未删弱重定向测试。

随后根代理对该 v4 检查点完成全量回归：**217/217，通过且无 skip**，结果保留在本机 `.scratch/checkpoint-v4-full-results.log`。caller 启动器另由根代理独立复跑11/11；尚在实现的 publication/host-open 模块不计入217，也没有据此扩大生产授权。

v4 同时把真实 tracker 归属传到底层 GH 命令闸，补原 `gh label list` 精确只读配方，并增加显式稳定本机数据根。生产仍使用固定旧只读运行包；候选未被当作用户已确认更新。真实私有仓库写、发布/打开窗口、登录自启、跨版本迁移与最终宿主 HITL仍由实施规格跟踪。

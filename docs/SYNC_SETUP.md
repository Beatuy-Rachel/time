# 跨设备同步方案

当前原型的数据保存在浏览器 `localStorage`，适合单设备试用，但不会自动同步到手机、平板或其他浏览器。

推荐使用 Supabase：

1. 创建 Supabase 项目并启用邮箱登录。
2. 建立 `user_data` 表：`user_id uuid primary key`、`payload jsonb not null`、`updated_at timestamptz not null`。
3. 开启 RLS，只允许用户读写 `user_id = auth.uid()` 的数据。
4. 将项目 URL、匿名 key 和登录入口接入应用的同步层。

真正接入前还需要确定登录方式和冲突策略。建议默认使用“最后一次更新时间较新的设备覆盖旧版本”，并保留手动导出 JSON 作为备份。

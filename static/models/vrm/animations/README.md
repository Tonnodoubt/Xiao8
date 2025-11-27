# VMD 动画文件目录

这个目录用于存放 VMD 动画文件。

## 目录结构

```
animations/
├── idle/          # 待机动作（站立、呼吸等）
├── dance/         # 舞蹈动作
└── gesture/       # 手势动作（挥手、点头等）
```

## 使用方法

### 方式一：与模型同名自动播放
将 VMD 文件放在与 VRM 模型相同的目录下，文件名与模型相同：
```
static/models/vrm/YourModel/
├── YourModel.vrm
└── YourModel.vmd  ← 同名文件，自动播放
```

### 方式二：手动指定路径播放
将 VMD 文件放在此目录下，通过完整路径引用：
```javascript
// 播放待机动作
await window.vrmManager.playVMDAnimation('/static/models/vrm/animations/idle/idle.vmd', {
    loop: true,
    timeScale: 1.0
});

// 播放舞蹈动作
await window.vrmManager.playVMDAnimation('/static/models/vrm/animations/dance/dance.vmd', {
    loop: true,
    timeScale: 1.0
});
```

## 文件命名建议

- 使用有意义的文件名，如：`idle.vmd`、`wave.vmd`、`dance_01.vmd`
- 避免使用特殊字符和中文（可能导致路径问题）
- 建议使用小写字母和下划线

## 注意事项

- VMD 文件通常很小（几KB到几MB）
- 确保文件扩展名是 `.vmd`
- 文件可以通过 HTTP 访问（放在 static 目录下）


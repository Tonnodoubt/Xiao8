# @moeru/three-mmd 库说明

## 这个库是做什么的？

`@moeru/three-mmd` 是一个专门用于在浏览器中加载和显示 **MMD（MikuMikuDance）模型** 的 JavaScript 库。

### 为什么需要这个库？

1. **MMD 模型格式特殊**：
   - MMD 模型使用 `.pmd` 或 `.pmx` 格式
   - 这些格式不是标准的 3D 模型格式（如 GLTF、OBJ）
   - Three.js 本身**不支持**直接加载 MMD 模型

2. **MMDLoader 的作用**：
   - `MMDLoader` 是 `@moeru/three-mmd` 提供的加载器
   - 它能够：
     - 解析 `.pmd` 和 `.pmx` 文件格式
     - 加载模型的几何体、材质、纹理
     - 处理模型的骨骼和动画
     - 支持模型的变形（morph）功能（用于口型同步）

3. **为什么选择 @moeru/three-mmd**：
   - 这是 Three.js r172+ 版本后，官方 MMDLoader 被移除后的替代方案
   - 专门为现代 Three.js 版本设计
   - 支持最新的 MMD 模型格式

## 库的位置

库已通过 npm 安装到：`static/libs/node_modules/@moeru/three-mmd/`

## 使用方式

由于这个库是 ES 模块格式，我们需要：
1. 使用构建工具打包成 UMD 格式，或者
2. 使用 ES 模块加载方式

## 当前状态

目前库已安装，但需要配置正确的加载方式才能在浏览器中使用。


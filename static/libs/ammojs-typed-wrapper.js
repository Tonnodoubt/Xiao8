// ammojs-typed ES 模块包装器
// 将 CommonJS 格式的 ammo.js 转换为 ES 模块
// ammo.js 已经通过 script 标签加载到全局，这里直接导出

// 直接导出全局 Ammo 对象
// 注意：这需要在 ammo.js 加载完成后才能工作
export default typeof Ammo !== 'undefined' ? Ammo : null;

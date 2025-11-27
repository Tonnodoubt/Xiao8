/**
 * VMD 动画文件测试工具
 * 用于检查 VMD 文件是否可以正常加载和播放
 */

/**
 * 获取所有 VMD 文件列表
 */
async function listVMDFiles() {
    try {
        // 从服务器获取文件列表（需要后端支持）
        // 或者手动列出已知的文件
        const vmdFiles = [
            '/static/models/vrm/animations/nekomimi_camera.vmd',
            '/static/models/vrm/animations/nekomimi_kuro.vmd',
            '/static/models/vrm/animations/nekomimi_lat.vmd',
            '/static/models/vrm/animations/nekomimi_mikuv2.vmd',
            '/static/models/vrm/animations/nekomimi_toro.vmd'
        ];
        
        return vmdFiles;
    } catch (error) {
        console.error('获取 VMD 文件列表失败:', error);
        return [];
    }
}

/**
 * 检查 VMD 文件是否存在
 */
async function checkVMDFile(vmdPath) {
    try {
        const response = await fetch(vmdPath, { method: 'HEAD' });
        return {
            exists: response.ok,
            size: response.headers.get('content-length'),
            path: vmdPath,
            name: vmdPath.split('/').pop()
        };
    } catch (error) {
        return {
            exists: false,
            error: error.message,
            path: vmdPath,
            name: vmdPath.split('/').pop()
        };
    }
}

/**
 * 测试加载 VMD 文件（不播放，只检查是否能解析）
 */
async function testLoadVMD(vmdPath) {
    try {
        const response = await fetch(vmdPath);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const buffer = await response.arrayBuffer();
        console.log(`[测试] ${vmdPath}: 文件大小 ${(buffer.byteLength / 1024).toFixed(2)} KB`);
        
        // 尝试解析 VMD 文件
        const { VMDParser } = await import('./vmd-loader.js');
        const vmdData = VMDParser.parse(buffer);
        
        return {
            success: true,
            path: vmdPath,
            name: vmdPath.split('/').pop(),
            size: buffer.byteLength,
            boneAnimations: vmdData.boneAnimations.length,
            expressionAnimations: vmdData.expressionAnimations.length,
            frameRate: vmdData.frameRate,
            modelName: vmdData.modelName,
            duration: vmdData.boneAnimations.length > 0 
                ? Math.max(...vmdData.boneAnimations.map(a => a.frameNumber)) / vmdData.frameRate 
                : 0
        };
    } catch (error) {
        return {
            success: false,
            path: vmdPath,
            name: vmdPath.split('/').pop(),
            error: error.message
        };
    }
}

/**
 * 测试所有 VMD 文件
 */
async function testAllVMDs() {
    console.log('=== 开始测试 VMD 文件 ===\n');
    
    const vmdFiles = await listVMDFiles();
    const results = [];
    
    for (const vmdPath of vmdFiles) {
        console.log(`正在测试: ${vmdPath}`);
        const result = await testLoadVMD(vmdPath);
        results.push(result);
        
        if (result.success) {
            console.log(`✓ 成功: ${result.name}`);
            console.log(`  骨骼动画: ${result.boneAnimations} 个`);
            console.log(`  表情动画: ${result.expressionAnimations} 个`);
            console.log(`  时长: ${result.duration.toFixed(2)} 秒`);
            console.log(`  文件大小: ${(result.size / 1024).toFixed(2)} KB\n`);
        } else {
            console.log(`✗ 失败: ${result.name}`);
            console.log(`  错误: ${result.error}\n`);
        }
    }
    
    console.log('=== 测试完成 ===');
    console.log(`总计: ${vmdFiles.length} 个文件`);
    console.log(`成功: ${results.filter(r => r.success).length} 个`);
    console.log(`失败: ${results.filter(r => !r.success).length} 个`);
    
    return results;
}

/**
 * 测试播放 VMD 动画（需要 VRM 模型已加载）
 */
async function testPlayVMD(vmdPath) {
    if (!window.vrmManager || !window.vrmManager.vrm) {
        console.error('VRM 模型未加载，无法测试播放');
        return false;
    }
    
    try {
        console.log(`开始播放: ${vmdPath}`);
        await window.vrmManager.playVMDAnimation(vmdPath, {
            loop: false,  // 测试时不循环
            timeScale: 1.0
        });
        console.log(`✓ 播放成功: ${vmdPath}`);
        return true;
    } catch (error) {
        console.error(`✗ 播放失败: ${vmdPath}`, error);
        return false;
    }
}

// 导出到全局
if (typeof window !== 'undefined') {
    window.VMDTester = {
        listVMDFiles,
        checkVMDFile,
        testLoadVMD,
        testAllVMDs,
        testPlayVMD
    };
    
    console.log('VMD 测试工具已加载，使用 window.VMDTester.testAllVMDs() 测试所有文件');
}

export { listVMDFiles, checkVMDFile, testLoadVMD, testAllVMDs, testPlayVMD };


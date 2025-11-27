#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
检查VRM模型与VMD动画文件的兼容性
分析VRM模型的骨骼结构，并检查哪些VMD文件可以适配
"""

import json
import os
import struct
import sys
from pathlib import Path
from collections import defaultdict

# 设置Windows控制台编码为UTF-8
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except:
        pass

# MMD到VRM的骨骼映射表（与vmd-loader.js中的映射一致）
MMD_TO_VRM_BONE_MAP = {
    # 核心骨骼（日文）
    'センター': 'hips',
    '上半身': 'spine',
    '下半身': 'hips',
    '首': 'neck',
    '頭': 'head',
    # 左臂（日文）
    '左肩': 'leftShoulder',
    '左腕': 'leftUpperArm',
    '左ひじ': 'leftLowerArm',
    '左手首': 'leftHand',
    # 右臂（日文）
    '右肩': 'rightShoulder',
    '右腕': 'rightUpperArm',
    '右ひじ': 'rightLowerArm',
    '右手首': 'rightHand',
    # 左腿（日文）
    '左足': 'leftUpperLeg',
    '左ひざ': 'leftLowerLeg',
    '左足首': 'leftFoot',
    # 右腿（日文）
    '右足': 'rightUpperLeg',
    '右ひざ': 'rightLowerLeg',
    '右足首': 'rightFoot',
}

def read_string_shift_jis(data, offset, length):
    """读取Shift-JIS编码的字符串"""
    try:
        bytes_data = data[offset:offset+length]
        # 移除null终止符
        null_pos = bytes_data.find(0)
        if null_pos >= 0:
            bytes_data = bytes_data[:null_pos]
        return bytes_data.decode('shift_jis', errors='ignore').strip('\x00')
    except:
        return ""

def parse_vmd_file(vmd_path):
    """解析VMD文件，提取使用的骨骼名称"""
    try:
        with open(vmd_path, 'rb') as f:
            data = f.read()
        
        # 检查文件头
        header = data[0:30].decode('ascii', errors='ignore')
        if not header.startswith('Vocaloid Motion Data'):
            return None, "无效的VMD文件格式"
        
        offset = 30
        # 读取模型名称（20字节）
        model_name = read_string_shift_jis(data, offset, 20)
        offset += 20
        
        # 读取骨骼动画数量（4字节，小端序）
        bone_count = struct.unpack('<I', data[offset:offset+4])[0]
        offset += 4
        
        # 读取骨骼动画数据
        bones_used = set()
        for i in range(bone_count):
            # 读取骨骼名称（15字节）
            bone_name = read_string_shift_jis(data, offset, 15)
            offset += 15
            
            if bone_name:
                bones_used.add(bone_name)
            
            # 跳过其他数据：帧号(4) + 位置(12) + 旋转(16) + 插值(64) = 96字节
            offset += 96
        
        return bones_used, None
    except Exception as e:
        return None, str(e)

def extract_vrm_bones(vrm_path):
    """从VRM文件中提取骨骼名称和humanBones映射"""
    try:
        with open(vrm_path, 'rb') as f:
            data = f.read()
        
        # GLB格式：前12字节是头部
        # 字节0-3: magic (glTF)
        # 字节4-7: version (uint32, little-endian)
        # 字节8-11: total length (uint32, little-endian)
        if data[:4] != b'glTF':
            return None, None, "不是有效的GLB文件"
        
        # 读取JSON块长度（字节12-15）
        json_length = struct.unpack('<I', data[12:16])[0]
        
        # 读取JSON块（字节16开始，长度json_length）
        json_chunk_type = data[16:20]  # 应该是 b'JSON'
        if json_chunk_type != b'JSON':
            return None, None, "GLB格式错误：找不到JSON块"
        
        json_data = json.loads(data[20:20+json_length].decode('utf-8'))
        
        # 提取骨骼名称
        bones = set()
        node_index_to_name = {}
        # humanBones映射：标准名称 -> 实际骨骼名称
        human_bones_map = {}
        
        # 从nodes中提取所有骨骼名称和索引映射
        if 'nodes' in json_data:
            for idx, node in enumerate(json_data['nodes']):
                if isinstance(node, dict) and 'name' in node and node['name']:
                    bone_name = str(node['name']).strip()
                    if bone_name:
                        bones.add(bone_name)
                        node_index_to_name[idx] = bone_name
        
        # 提取VRM扩展中的骨骼信息（这是最重要的）
        if 'extensions' in json_data and 'VRM' in json_data['extensions']:
            vrm_data = json_data['extensions']['VRM']
            if 'humanoid' in vrm_data and 'humanBones' in vrm_data['humanoid']:
                human_bones = vrm_data['humanoid']['humanBones']
                # humanBones是字典，键是标准骨骼类型（如'hips', 'spine'），值是骨骼信息
                if isinstance(human_bones, dict):
                    for bone_type, bone_info in human_bones.items():
                        if isinstance(bone_info, dict):
                            # 可能是节点索引或节点名称
                            if 'node' in bone_info:
                                node_ref = bone_info['node']
                                actual_bone_name = None
                                if isinstance(node_ref, int):
                                    # 是索引，查找对应的名称
                                    if node_ref in node_index_to_name:
                                        actual_bone_name = node_index_to_name[node_ref]
                                        bones.add(actual_bone_name)
                                elif isinstance(node_ref, str) and node_ref:
                                    # 是名称
                                    actual_bone_name = node_ref
                                    bones.add(actual_bone_name)
                                
                                # 建立映射：标准名称 -> 实际骨骼名称
                                if actual_bone_name:
                                    human_bones_map[bone_type] = actual_bone_name
                elif isinstance(human_bones, list):
                    # humanBones是列表，每个元素包含'bone'（标准名称）和'node'（节点索引或名称）
                    for bone_info in human_bones:
                        if isinstance(bone_info, dict):
                            bone_type = bone_info.get('bone')  # 标准骨骼名称（如'hips', 'spine'）
                            node_ref = bone_info.get('node')
                            
                            actual_bone_name = None
                            if isinstance(node_ref, int):
                                # 是索引，查找对应的名称
                                if node_ref in node_index_to_name:
                                    actual_bone_name = node_index_to_name[node_ref]
                                    bones.add(actual_bone_name)
                            elif isinstance(node_ref, str) and node_ref:
                                # 是名称
                                actual_bone_name = node_ref
                                bones.add(actual_bone_name)
                            
                            # 建立映射：标准名称 -> 实际骨骼名称
                            if bone_type and actual_bone_name:
                                human_bones_map[bone_type] = actual_bone_name
        
        return bones, human_bones_map, None
    except Exception as e:
        import traceback
        return None, None, f"{str(e)}\n{traceback.format_exc()}"

def check_compatibility(vrm_bones, vmd_bones, human_bones_map=None):
    """检查VMD文件与VRM模型的兼容性"""
    mapped_bones = []
    unmapped_bones = []
    
    # 创建大小写不敏感的骨骼名称映射
    vrm_bones_lower = {b.lower(): b for b in vrm_bones}
    
    for mmd_bone in vmd_bones:
        vrm_bone_standard = MMD_TO_VRM_BONE_MAP.get(mmd_bone)
        if vrm_bone_standard:
            # 首先尝试通过humanBones映射找到实际骨骼名称
            actual_bone_name = None
            if human_bones_map and vrm_bone_standard in human_bones_map:
                actual_bone_name = human_bones_map[vrm_bone_standard]
            
            # 如果找到了实际骨骼名称，检查是否存在
            if actual_bone_name and actual_bone_name in vrm_bones:
                mapped_bones.append((mmd_bone, vrm_bone_standard, actual_bone_name))
            # 否则尝试大小写不敏感匹配
            elif vrm_bone_standard.lower() in vrm_bones_lower:
                actual_bone_name = vrm_bones_lower[vrm_bone_standard.lower()]
                mapped_bones.append((mmd_bone, vrm_bone_standard, actual_bone_name))
            # 尝试直接匹配（可能大小写不同）
            elif vrm_bone_standard in vrm_bones:
                mapped_bones.append((mmd_bone, vrm_bone_standard, vrm_bone_standard))
            else:
                unmapped_bones.append((mmd_bone, vrm_bone_standard))
        else:
            unmapped_bones.append((mmd_bone, None))
    
    compatibility_score = len(mapped_bones) / len(vmd_bones) if vmd_bones else 0
    
    return {
        'mapped_bones': mapped_bones,
        'unmapped_bones': unmapped_bones,
        'compatibility_score': compatibility_score,
        'total_bones': len(vmd_bones),
        'mapped_count': len(mapped_bones)
    }

def main():
    # 查找VRM模型文件
    vrm_path = Path('static/models/vrm/HatsuneMikuNT/Miku.vrm')
    if not vrm_path.exists():
        print(f"错误：找不到VRM模型文件: {vrm_path}")
        return
    
    print(f"正在分析VRM模型: {vrm_path}")
    vrm_bones, human_bones_map, error = extract_vrm_bones(vrm_path)
    if error:
        print(f"解析VRM文件时出错: {error}")
        return
    
    print(f"\nVRM模型包含 {len(vrm_bones)} 个骨骼节点")
    
    # 显示humanBones映射
    if human_bones_map:
        print(f"\nVRM HumanBones映射 ({len(human_bones_map)} 个标准骨骼):")
        for std_name, actual_name in sorted(human_bones_map.items()):
            print(f"  {std_name} -> {actual_name}")
    
    # 显示一些实际的骨骼名称（前20个）
    print("\nVRM模型中的部分骨骼名称（前20个）:")
    sample_bones = sorted([str(b) for b in vrm_bones if b])[:20]
    for bone in sample_bones:
        print(f"  - {bone}")
    if len(vrm_bones) > 20:
        print(f"  ... 还有 {len(vrm_bones) - 20} 个骨骼")
    
    print("\n检查VRM标准骨骼:")
    vrm_standard_bones = [
        'hips', 'spine', 'neck', 'head',
        'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
        'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
        'leftUpperLeg', 'leftLowerLeg', 'leftFoot',
        'rightUpperLeg', 'rightLowerLeg', 'rightFoot'
    ]
    found_standard = []
    for bone in vrm_standard_bones:
        if bone in vrm_bones:
            print(f"  [OK] {bone}")
            found_standard.append(bone)
        else:
            print(f"  [X] {bone} (缺失)")
    
    # 尝试查找可能的匹配（不区分大小写）
    print("\n尝试查找可能的匹配（不区分大小写）:")
    vrm_bones_lower = {b.lower(): b for b in vrm_bones}
    for std_bone in vrm_standard_bones:
        if std_bone not in found_standard:
            # 尝试查找包含标准名称的骨骼
            matches = [b for b in vrm_bones if std_bone.lower() in b.lower() or b.lower() in std_bone.lower()]
            if matches:
                print(f"  [~] {std_bone} -> 可能的匹配: {matches[:3]}")
    
    # 查找所有VMD文件
    vmd_dir = Path('static/models/vrm/animations')
    if not vmd_dir.exists():
        print(f"\n错误：找不到VMD目录: {vmd_dir}")
        return
    
    vmd_files = list(vmd_dir.glob('*.vmd'))
    print(f"\n找到 {len(vmd_files)} 个VMD文件")
    
    # 分析每个VMD文件
    results = []
    for vmd_file in sorted(vmd_files):
        print(f"\n分析: {vmd_file.name}")
        vmd_bones, error = parse_vmd_file(vmd_file)
        if error:
            print(f"  错误: {error}")
            continue
        
        if not vmd_bones:
            print(f"  警告: 未找到骨骼数据")
            continue
        
        print(f"  使用了 {len(vmd_bones)} 个不同的骨骼")
        compat = check_compatibility(vrm_bones, vmd_bones, human_bones_map)
        
        results.append({
            'file': vmd_file.name,
            'compatibility': compat
        })
        
        print(f"  兼容性评分: {compat['compatibility_score']:.1%} ({compat['mapped_count']}/{compat['total_bones']})")
        
        if compat['unmapped_bones']:
            print(f"  无法映射的骨骼 ({len(compat['unmapped_bones'])}):")
            for mmd_bone, vrm_bone in compat['unmapped_bones'][:5]:  # 只显示前5个
                if vrm_bone:
                    print(f"    - {mmd_bone} -> {vrm_bone} (VRM模型中不存在)")
                else:
                    print(f"    - {mmd_bone} (未在映射表中)")
            if len(compat['unmapped_bones']) > 5:
                print(f"    ... 还有 {len(compat['unmapped_bones']) - 5} 个")
    
    # 生成总结报告
    print("\n" + "="*60)
    print("兼容性总结报告")
    print("="*60)
    
    # 按兼容性评分排序
    results.sort(key=lambda x: x['compatibility']['compatibility_score'], reverse=True)
    
    print("\n【高兼容性 VMD 文件】（兼容度 >= 80%）:")
    high_compat = [r for r in results if r['compatibility']['compatibility_score'] >= 0.8]
    if high_compat:
        for r in high_compat:
            score = r['compatibility']['compatibility_score']
            print(f"  [OK] {r['file']} ({score:.1%})")
    else:
        print("  无")
    
    print("\n【中等兼容性 VMD 文件】（兼容度 50%-80%）:")
    mid_compat = [r for r in results if 0.5 <= r['compatibility']['compatibility_score'] < 0.8]
    if mid_compat:
        for r in mid_compat:
            score = r['compatibility']['compatibility_score']
            print(f"  [~] {r['file']} ({score:.1%})")
    else:
        print("  无")
    
    print("\n【低兼容性 VMD 文件】（兼容度 < 50%）:")
    low_compat = [r for r in results if r['compatibility']['compatibility_score'] < 0.5]
    if low_compat:
        for r in low_compat:
            score = r['compatibility']['compatibility_score']
            print(f"  [X] {r['file']} ({score:.1%})")
    else:
        print("  无")
    
    print(f"\n总计: {len(results)} 个VMD文件")
    print(f"  高兼容性: {len(high_compat)} 个")
    print(f"  中等兼容性: {len(mid_compat)} 个")
    print(f"  低兼容性: {len(low_compat)} 个")

if __name__ == '__main__':
    main()


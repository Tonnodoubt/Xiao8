import json
import os
from typing import Dict, Any, Optional, List
from datetime import datetime
from utils.config_manager import get_config_manager

# 初始化配置管理器
_config_manager = get_config_manager()

# 用户偏好文件路径（从配置管理器获取）
PREFERENCES_FILE = str(_config_manager.get_config_path('user_preferences.json'))

def load_user_preferences() -> List[Dict[str, Any]]:
    """
    加载用户偏好设置
    
    Returns:
        List[Dict[str, Any]]: 用户偏好列表，每个元素对应一个模型的偏好设置，如果文件不存在或读取失败则返回空列表
    """
    try:
        if os.path.exists(PREFERENCES_FILE):
            with open(PREFERENCES_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # 兼容旧格式：如果是字典格式，转换为列表格式
                if isinstance(data, dict):
                    if 'model_path' in data and 'position' in data and 'scale' in data:
                        return [data]  # 将旧格式转换为列表
                    else:
                        return []
                elif isinstance(data, list):
                    return data
                else:
                    return []
    except Exception as e:
        print(f"加载用户偏好失败: {e}")
    return []

def save_user_preferences(preferences: List[Dict[str, Any]]) -> bool:
    """
    保存用户偏好设置
    
    Args:
        preferences (List[Dict[str, Any]]): 要保存的偏好设置列表
        
    Returns:
        bool: 保存成功返回True，失败返回False
    """
    try:
        # 确保配置目录存在
        _config_manager.ensure_config_directory()
        # 更新路径（可能已迁移）
        global PREFERENCES_FILE
        PREFERENCES_FILE = str(_config_manager.get_config_path('user_preferences.json'))
        
        with open(PREFERENCES_FILE, 'w', encoding='utf-8') as f:
            json.dump(preferences, f, ensure_ascii=False, indent=2)
        return True
    except Exception as e:
        print(f"保存用户偏好失败: {e}")
        return False

def update_model_preferences(model_path: str, position: Dict[str, float], scale: Dict[str, float]) -> bool:
    """
    更新指定模型的偏好设置
    
    Args:
        model_path (str): 模型路径
        position (Dict[str, float]): 位置信息 {'x': float, 'y': float}
        scale (Dict[str, float]): 缩放信息 {'x': float, 'y': float}
        
    Returns:
        bool: 更新成功返回True，失败返回False
    """
    try:
        # 加载现有偏好
        current_preferences = load_user_preferences()
        
        # 查找是否已存在该模型的偏好
        model_index = -1
        for i, pref in enumerate(current_preferences):
            if pref.get('model_path') == model_path:
                model_index = i
                break
        
        # 创建新的模型偏好
        new_model_pref = {
            'model_path': model_path,
            'position': position,
            'scale': scale
        }
        
        if model_index >= 0:
            # 更新现有模型的偏好
            current_preferences[model_index] = new_model_pref
        else:
            # 添加新模型的偏好到列表开头（作为首选）
            current_preferences.insert(0, new_model_pref)
        
        # 保存更新后的偏好
        return save_user_preferences(current_preferences)
    except Exception as e:
        print(f"更新模型偏好失败: {e}")
        return False

def get_model_preferences(model_path: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    获取指定模型的偏好设置，如果不指定则返回首选模型（列表第一个）的偏好
    
    Args:
        model_path (str, optional): 模型路径，如果不指定则返回首选模型
        
    Returns:
        Optional[Dict[str, Any]]: 包含model_path, position, scale的字典，如果没有则返回None
    """
    preferences = load_user_preferences()
    
    if not preferences:
        return None
    
    if model_path:
        # 查找指定模型的偏好
        for pref in preferences:
            if pref.get('model_path') == model_path:
                return pref
        return None
    else:
        # 返回首选模型（列表第一个）的偏好
        return preferences[0] if preferences else None

def get_preferred_model_path() -> Optional[str]:
    """
    获取首选模型的路径
    
    Returns:
        Optional[str]: 首选模型的路径，如果没有则返回None
    """
    preferences = load_user_preferences()
    if preferences and len(preferences) > 0:
        return preferences[0].get('model_path')
    return None

def validate_model_preferences(preferences: Dict[str, Any]) -> bool:
    """
    验证模型偏好设置是否包含必要字段
    
    Args:
        preferences (Dict[str, Any]): 要验证的模型偏好设置
        
    Returns:
        bool: 验证通过返回True，失败返回False
    """
    required_fields = ['model_path', 'position', 'scale']
    
    # 检查必要字段是否存在
    for field in required_fields:
        if field not in preferences:
            return False
    
    # 检查position和scale是否包含必要的子字段
    if not isinstance(preferences.get('position'), dict) or 'x' not in preferences['position'] or 'y' not in preferences['position']:
        return False
    
    if not isinstance(preferences.get('scale'), dict) or 'x' not in preferences['scale'] or 'y' not in preferences['scale']:
        return False
    
    return True

def move_model_to_top(model_path: str) -> bool:
    """
    将指定模型移动到列表顶部（设为首选）
    
    Args:
        model_path (str): 模型路径
        
    Returns:
        bool: 操作成功返回True，失败返回False
    """
    try:
        preferences = load_user_preferences()
        
        # 查找模型索引
        model_index = -1
        for i, pref in enumerate(preferences):
            if pref.get('model_path') == model_path:
                model_index = i
                break
        
        if model_index >= 0:
            # 将模型移动到顶部
            model_pref = preferences.pop(model_index)
            preferences.insert(0, model_pref)
            return save_user_preferences(preferences)
        else:
            # 如果模型不存在，返回False
            return False
    except Exception as e:
        print(f"移动模型到顶部失败: {e}")
        return False

# ============================================================================
# Live2D 参数预设管理
# ============================================================================

# 参数预设文件路径
PARAMETER_PRESETS_FILE = str(_config_manager.get_config_path('live2d_parameter_presets.json'))

def load_parameter_presets(model_path: Optional[str] = None) -> Dict[str, Any]:
    """
    加载 Live2D 参数预设
    
    Args:
        model_path (str, optional): 模型路径，如果指定则只返回该模型的预设
        
    Returns:
        Dict[str, Any]: 预设字典，格式为 { preset_name: { model_path, values, timestamp } }
                       如果指定了 model_path，则只返回该模型的预设
    """
    try:
        if os.path.exists(PARAMETER_PRESETS_FILE):
            with open(PARAMETER_PRESETS_FILE, 'r', encoding='utf-8') as f:
                all_presets = json.load(f)
                
                if model_path:
                    # 只返回指定模型的预设
                    # 统一路径格式：移除查询参数，标准化路径
                    normalized_model_path = model_path.split('?')[0]  # 移除查询参数
                    filtered_presets = {}
                    for name, preset in all_presets.items():
                        preset_path = preset.get('model_path', '')
                        # 标准化预设路径
                        normalized_preset_path = preset_path.split('?')[0]
                        # 精确匹配或文件名匹配
                        if (normalized_preset_path == normalized_model_path or 
                            normalized_preset_path.endswith(normalized_model_path) or
                            normalized_model_path.endswith(normalized_preset_path) or
                            # 提取文件名进行匹配
                            normalized_preset_path.split('/')[-1] == normalized_model_path.split('/')[-1]):
                            filtered_presets[name] = preset
                    return filtered_presets
                else:
                    return all_presets
    except Exception as e:
        print(f"加载参数预设失败: {e}")
    return {}

def save_parameter_preset(preset_name: str, model_path: str, values: Dict[str, float]) -> bool:
    """
    保存 Live2D 参数预设
    
    Args:
        preset_name (str): 预设名称
        model_path (str): 模型路径
        values (Dict[str, float]): 参数值字典 { paramId: value }
        
    Returns:
        bool: 保存成功返回True，失败返回False
    """
    try:
        # 确保配置目录存在
        _config_manager.ensure_config_directory()
        # 更新路径（可能已迁移）
        global PARAMETER_PRESETS_FILE
        PARAMETER_PRESETS_FILE = str(_config_manager.get_config_path('live2d_parameter_presets.json'))
        
        # 加载现有预设
        all_presets = load_parameter_presets()
        
        # 添加或更新预设
        all_presets[preset_name] = {
            'model_path': model_path,
            'values': values,
            'timestamp': datetime.now().isoformat()
        }
        
        # 保存到文件
        with open(PARAMETER_PRESETS_FILE, 'w', encoding='utf-8') as f:
            json.dump(all_presets, f, ensure_ascii=False, indent=2)
        
        return True
    except Exception as e:
        print(f"保存参数预设失败: {e}")
        return False

def delete_parameter_preset(preset_name: str) -> bool:
    """
    删除 Live2D 参数预设
    
    Args:
        preset_name (str): 预设名称
        
    Returns:
        bool: 删除成功返回True，失败返回False
    """
    try:
        # 加载现有预设
        all_presets = load_parameter_presets()
        
        # 删除指定预设
        if preset_name in all_presets:
            del all_presets[preset_name]
            
            # 保存到文件
            with open(PARAMETER_PRESETS_FILE, 'w', encoding='utf-8') as f:
                json.dump(all_presets, f, ensure_ascii=False, indent=2)
            
            return True
        else:
            return False
    except Exception as e:
        print(f"删除参数预设失败: {e}")
        return False

def get_parameter_preset(preset_name: str) -> Optional[Dict[str, Any]]:
    """
    获取指定的参数预设
    
    Args:
        preset_name (str): 预设名称
        
    Returns:
        Optional[Dict[str, Any]]: 预设数据，如果不存在则返回None
    """
    try:
        all_presets = load_parameter_presets()
        return all_presets.get(preset_name)
    except Exception as e:
        print(f"获取参数预设失败: {e}")
        return None 
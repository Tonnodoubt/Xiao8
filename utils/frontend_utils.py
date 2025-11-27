# Copyright (c) 2024 Alibaba Inc (authors: Xiang Lyu, Zhihao Du)
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import re
import regex
import os
import logging
import json
from pathlib import Path
import requests

chinese_char_pattern = re.compile(r'[\u4e00-\u9fff]+')
bracket_patterns = [re.compile(r'\(.*?\)'),
                   re.compile('（.*?）')]

def remove_bracket(text):
    """移除文本中的括号及其内容"""
    for pattern in bracket_patterns:
        text = pattern.sub('', text)
    return text

def split_paragraph(text):
    """将文本按段落分割"""
    paragraphs = text.split('\n\n')
    return [p.strip() for p in paragraphs if p.strip()]

# whether contain chinese character
def contains_chinese(text):
    return bool(chinese_char_pattern.search(text))


# replace blank
def replace_blank(text):
    """替换文本中的空白字符"""
    return text.replace(' ', '')

# replace special symbol
def replace_corner_mark(text):
    text = text.replace('²', '平方')
    text = text.replace('³', '立方')
    return text

def estimate_speech_time(text, unit_duration=0.2):
    # 中文汉字范围
    chinese_chars = re.findall(r'[\u4e00-\u9fff]', text)
    chinese_units = len(chinese_chars) * 1.5

    # 日文假名范围（平假名 3040–309F，片假名 30A0–30FF）
    japanese_kana = re.findall(r'[\u3040-\u30FF]', text)
    japanese_units = len(japanese_kana) * 1.0

    # 英文单词（连续的 a-z 或 A-Z）
    english_words = re.findall(r'\b[a-zA-Z]+\b', text)
    english_units = len(english_words) * 1.5

    # 数字
    numbers = re.findall(r'\d+', text)
    number_units = len(numbers) * 0.5

    # 标点符号
    punctuation = re.findall(r'[，。！？、；：""''（）【】《》]', text)
    punctuation_units = len(punctuation) * 0.3

    total_units = chinese_units + japanese_units + english_units + number_units + punctuation_units
    estimated_time = total_units * unit_duration

    return max(estimated_time, 0.5)  # 至少0.5秒


def is_only_punctuation(text):
    # Regular expression: Match strings that consist only of punctuation marks or are empty.
    punctuation_pattern = r'^[\p{P}\p{S}]*$'
    return bool(regex.fullmatch(punctuation_pattern, text))


def find_models():
    """
    递归扫描 'static' 文件夹和用户文档下的 'live2d' 文件夹，查找所有包含 '.model3.json' 文件的子目录。
    """
    from utils.config_manager import get_config_manager
    
    found_models = []
    search_dirs = []
    
    # 添加static目录
    static_dir = 'static'
    if os.path.exists(static_dir):
        search_dirs.append(('static', static_dir, '/static'))
    else:
        logging.warning(f"警告：static文件夹路径不存在: {static_dir}")
    
    # 添加用户文档目录下的live2d文件夹
    try:
        config_mgr = get_config_manager()
        config_mgr.ensure_live2d_directory()
        docs_live2d_dir = str(config_mgr.live2d_dir)
        if os.path.exists(docs_live2d_dir):
            search_dirs.append(('documents', docs_live2d_dir, '/user_live2d'))
    except Exception as e:
        logging.warning(f"无法访问用户文档live2d目录: {e}")
    
    # 遍历所有搜索目录
    for source, search_root_dir, url_prefix in search_dirs:
        try:
            # os.walk会遍历指定的根目录下的所有文件夹和文件
            for root, dirs, files in os.walk(search_root_dir):
                for file in files:
                    if file.endswith('.model3.json'):
                        # 获取模型名称 (使用其所在的文件夹名，更加直观)
                        model_name = os.path.basename(root)
                        
                        # 构建可被浏览器访问的URL路径
                        # 1. 计算文件相对于 search_root_dir 的路径
                        relative_path = os.path.relpath(os.path.join(root, file), search_root_dir)
                        # 2. 将本地路径分隔符 (如'\') 替换为URL分隔符 ('/')
                        model_path = relative_path.replace(os.path.sep, '/')
                        
                        # 如果模型名称已存在，添加来源后缀以区分
                        existing_names = [m["name"] for m in found_models]
                        display_name = model_name
                        if model_name in existing_names:
                            display_name = f"{model_name}_{source}"
                        
                        found_models.append({
                            "name": display_name,
                            "path": f"{url_prefix}/{model_path}",
                            "source": source
                        })
                        
                        # 优化：一旦在某个目录找到模型json，就无需再继续深入该目录的子目录
                        dirs[:] = []
                        break
        except Exception as e:
            logging.error(f"搜索目录 {search_root_dir} 时出错: {e}")
                
    return found_models

# --- 工具函数 ---
def get_upload_policy(api_key, model_name):
    url = "https://dashscope.aliyuncs.com/api/v1/uploads"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    data = {
        "model": model_name
    }
    response = requests.post(url, headers=headers, json=data)
    return response.json()

def upload_file_to_oss(policy_data, file_path):
    import oss2
    
    auth = oss2.StsAuth(
        policy_data['credentials']['AccessKeyId'],
        policy_data['credentials']['AccessKeySecret'],
        policy_data['credentials']['SecurityToken']
    )
    bucket = oss2.Bucket(auth, policy_data['endpoint'], policy_data['bucket'])
    
    key = policy_data['key']
    bucket.put_object_from_file(key, file_path)

    return f'oss://{key}'


def find_model_directory(model_name: str):
    """
    查找模型目录，优先在用户文档目录，其次在static目录
    返回 (实际路径, URL前缀) 元组
    """
    from utils.config_manager import get_config_manager
    
    # 首先尝试在用户文档目录
    try:
        config_mgr = get_config_manager()
        docs_model_dir = config_mgr.live2d_dir / model_name
        if docs_model_dir.exists():
            return (str(docs_model_dir), '/user_live2d')
    except Exception as e:
        logging.warning(f"检查文档目录模型时出错: {e}")
    
    # 然后尝试static目录
    static_model_dir = os.path.join('static', model_name)
    if os.path.exists(static_model_dir):
        return (static_model_dir, '/static')
    
    # 如果都不存在，返回static默认路径
    return (static_model_dir, '/static')

def find_model_config_file(model_name: str) -> str:
    """
    查找模型配置文件路径，优先在用户文档目录，其次在static目录
    返回可被浏览器访问的URL路径
    """
    from utils.config_manager import get_config_manager
    
    # 首先尝试在用户文档目录
    try:
        config_mgr = get_config_manager()
        docs_model_dir = config_mgr.live2d_dir / model_name
        if docs_model_dir.exists():
            return f"/user_live2d/{model_name}/{model_name}.model3.json"
    except Exception as e:
        logging.warning(f"检查文档目录模型时出错: {e}")
    
    # 然后尝试static目录
    static_model_dir = os.path.join('static', model_name)
    if os.path.exists(static_model_dir):
        return f"/static/{model_name}/{model_name}.model3.json"
    
    # 如果都不存在，返回static默认路径
    url_prefix = '/static'
    return f"{url_prefix}/{model_name}/{model_name}.model3.json"


def find_vrm_models():
    """
    递归扫描 'static/models/vrm' 文件夹和用户文档下的 'vrm' 文件夹，查找所有 .vrm 文件。
    """
    from utils.config_manager import get_config_manager
    
    found_models = []
    search_dirs = []
    
    # 添加static目录下的vrm文件夹
    static_vrm_dir = os.path.join('static', 'models', 'vrm')
    if os.path.exists(static_vrm_dir):
        search_dirs.append(('static', static_vrm_dir, '/static/models/vrm'))
    else:
        logging.warning(f"警告：static/models/vrm文件夹路径不存在: {static_vrm_dir}")
    
    # 添加用户文档目录下的vrm文件夹（如果存在）
    try:
        config_mgr = get_config_manager()
        # 尝试在用户文档目录下查找vrm文件夹
        user_docs_dir = config_mgr.config_dir.parent if hasattr(config_mgr, 'config_dir') else None
        if user_docs_dir:
            user_vrm_dir = user_docs_dir / 'vrm'
            if user_vrm_dir.exists():
                search_dirs.append(('documents', str(user_vrm_dir), '/user_vrm'))
    except Exception as e:
        logging.warning(f"无法访问用户文档vrm目录: {e}")
    
    # 遍历所有搜索目录
    for source, search_root_dir, url_prefix in search_dirs:
        try:
            # os.walk会遍历指定的根目录下的所有文件夹和文件
            for root, dirs, files in os.walk(search_root_dir):
                for file in files:
                    if file.endswith('.vrm'):
                        # 获取模型名称（去掉.vrm扩展名）
                        model_name = file.replace('.vrm', '')
                        
                        # 构建可被浏览器访问的URL路径
                        # 1. 计算文件相对于 search_root_dir 的路径
                        relative_path = os.path.relpath(os.path.join(root, file), search_root_dir)
                        # 2. 将本地路径分隔符 (如'\') 替换为URL分隔符 ('/')
                        model_path = relative_path.replace(os.path.sep, '/')
                        
                        # 如果模型名称已存在，添加来源后缀以区分
                        existing_names = [m["name"] for m in found_models]
                        display_name = model_name
                        if model_name in existing_names:
                            display_name = f"{model_name}_{source}"
                        
                        found_models.append({
                            "name": display_name,
                            "path": f"{url_prefix}/{model_path}",
                            "source": source
                        })
        except Exception as e:
            logging.error(f"搜索目录 {search_root_dir} 时出错: {e}")
                
    return found_models

def find_vmd_animations():
    """
    递归扫描 'static/models/vrm/animations' 文件夹，查找所有 .vmd 文件。
    正确处理 Windows 上的 Shift-JIS 编码文件名。
    """
    import sys
    import urllib.parse
    
    found_animations = []
    animations_dir = os.path.join('static', 'models', 'vrm', 'animations')
    
    if not os.path.exists(animations_dir):
        logging.warning(f"警告：animations文件夹路径不存在: {animations_dir}")
        return found_animations
    
    try:
        # 递归遍历目录查找所有 .vmd 文件
        for root, dirs, files in os.walk(animations_dir):
            for file in files:
                if file.endswith('.vmd'):
                    # 在 Windows 上，文件名可能是 Shift-JIS 编码的
                    # 需要正确转换为 UTF-8 用于显示
                    file_name_display = file.replace('.vmd', '')
                    
                    if sys.platform == 'win32':
                        try:
                            # 方法：将文件名从系统编码（可能是 Shift-JIS）转换为 UTF-8
                            # 先获取文件名的原始字节表示
                            file_bytes = file.encode(sys.getfilesystemencoding(), errors='surrogateescape')
                            # 尝试从 Shift-JIS 解码
                            try:
                                file_name_display = file_bytes.decode('shift_jis', errors='ignore').replace('.vmd', '')
                            except:
                                # 如果 Shift-JIS 失败，尝试从系统编码解码
                                try:
                                    file_name_display = file_bytes.decode('utf-8', errors='ignore').replace('.vmd', '')
                                except:
                                    pass
                        except Exception as e:
                            logging.debug(f"文件名编码转换失败: {file}, 使用原始名称")
                    
                    # 构建可被浏览器访问的URL路径
                    # 使用原始文件名构建路径（需要 URL 编码）
                    relative_path = os.path.relpath(os.path.join(root, file), animations_dir)
                    # 将本地路径分隔符 (如'\') 替换为URL分隔符 ('/')
                    file_path = relative_path.replace(os.path.sep, '/')
                    
                    # URL 编码路径的每个部分
                    path_parts = file_path.split('/')
                    encoded_parts = []
                    for part in path_parts:
                        # 对每个路径部分进行 URL 编码
                        encoded_parts.append(urllib.parse.quote(part, safe=''))
                    encoded_file_path = '/'.join(encoded_parts)
                    
                    found_animations.append({
                        "name": file_name_display,
                        "path": f"/static/models/vrm/animations/{encoded_file_path}"
                    })
    except Exception as e:
        logging.error(f"搜索animations目录时出错: {e}")
    
    # 按文件名排序
    found_animations.sort(key=lambda x: x["name"])
    
    return found_animations

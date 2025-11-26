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

# whether contain chinese character
def contains_chinese(text):
    return bool(chinese_char_pattern.search(text))


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

    total_units = chinese_units + japanese_units + english_units
    estimated_seconds = total_units * unit_duration

    return estimated_seconds

# remove meaningless symbol
def remove_bracket(text):
    for p in bracket_patterns:
        text = p.sub('', text)
    text = text.replace('【', '').replace('】', '')
    text = text.replace('《', '').replace('》', '')
    text = text.replace('`', '').replace('`', '')
    text = text.replace("——", " ")
    text = text.replace("（", "").replace("）", "").replace("(", "").replace(")", "")
    return text




# split paragrah logic：
# 1. per sentence max len token_max_n, min len token_min_n, merge if last sentence len less than merge_len
# 2. cal sentence len according to lang
# 3. split sentence according to punctuation
# 4. 返回（要处理的文本，剩余buffer）
def split_paragraph(text: str, force_process=False, lang="zh", token_min_n=2.5, comma_split=True):
    def calc_utt_length(_text: str):
        return estimate_speech_time(_text)

    if lang == "zh":
        pounc = ['。', '？', '！', '；', '：', '、', '.', '?', '!', ';']
    else:
        pounc = ['.', '?', '!', ';', ':']
    if comma_split:
        pounc.extend(['，', ','])

    st = 0
    utts = []
    for i, c in enumerate(text):
        if c in pounc:
            if len(text[st: i]) > 0:
                utts.append(text[st: i+1])
            if i + 1 < len(text) and text[i + 1] in ['"', '”']:
                tmp = utts.pop(-1)
                utts.append(tmp + text[i + 1])
                st = i + 2
            else:
                st = i + 1

    if len(utts) == 0: # 没有一个标点
        if force_process:
            return text, ""
        else:
            return "", text
    elif calc_utt_length(utts[-1]) > token_min_n: #如果最后一个utt长度达标
        # print(f"💼后端进行切割：|| {''.join(utts)} || {text[st:]}")
        return ''.join(utts), text[st:]
    elif len(utts)==1: #如果长度不达标，但没有其他utt
        if force_process:
            return text, ""
        else:
            return "", text
    else:
        # print(f"💼后端进行切割：|| {''.join(utts[:-1])} || {utts[-1] + text[st:]}")
        return ''.join(utts[:-1]), utts[-1] + text[st:]

# remove blank between chinese character
def replace_blank(text: str):
    out_str = []
    for i, c in enumerate(text):
        if c == " ":
            if ((text[i + 1].isascii() and text[i + 1] != " ") and
                    (text[i - 1].isascii() and text[i - 1] != " ")):
                out_str.append(c)
        else:
            out_str.append(c)
    return "".join(out_str)


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
    params = {
        "action": "getPolicy",
        "model": model_name
    }
    response = requests.get(url, headers=headers, params=params)
    if response.status_code != 200:
        raise Exception(f"获取上传凭证失败: {response.text}")
    return response.json()['data']

def upload_file_to_oss(policy_data, file_path):
    file_name = Path(file_path).name
    key = f"{policy_data['upload_dir']}/{file_name}"
    with open(file_path, 'rb') as file:
        files = {
            'OSSAccessKeyId': (None, policy_data['oss_access_key_id']),
            'Signature': (None, policy_data['signature']),
            'policy': (None, policy_data['policy']),
            'x-oss-object-acl': (None, policy_data['x_oss_object_acl']),
            'x-oss-forbid-overwrite': (None, policy_data['x_oss_forbid_overwrite']),
            'key': (None, key),
            'success_action_status': (None, '200'),
            'file': (file_name, file)
        }
        response = requests.post(policy_data['upload_host'], files=files)
        if response.status_code != 200:
            raise Exception(f"上传文件失败: {response.text}")
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
    在模型目录中查找.model3.json配置文件
    返回可访问的URL路径
    """
    model_dir, url_prefix = find_model_directory(model_name)
    
    if not os.path.exists(model_dir):
        return f"{url_prefix}/{model_name}/{model_name}.model3.json"  # 默认路径
    
    # 查找.model3.json文件
    for file in os.listdir(model_dir):
        if file.endswith('.model3.json'):
            return f"{url_prefix}/{model_name}/{file}"
    
    # 如果没找到，返回默认路径
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
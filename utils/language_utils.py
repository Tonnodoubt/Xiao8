# -*- coding: utf-8 -*-
"""
语言检测和翻译工具模块
用于检测文本语言并翻译到目标语言
"""
import re
import logging
from typing import Optional
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from utils.config_manager import get_config_manager

logger = logging.getLogger(__name__)

# 语言检测正则表达式
CHINESE_PATTERN = re.compile(r'[\u4e00-\u9fff]')
JAPANESE_PATTERN = re.compile(r'[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]')  # 平假名、片假名、汉字
ENGLISH_PATTERN = re.compile(r'[a-zA-Z]')


def detect_language(text: str) -> str:
    """
    检测文本的主要语言
    
    Args:
        text: 要检测的文本
        
    Returns:
        'zh' (中文), 'ja' (日语), 'en' (英文), 或 'unknown'
    """
    if not text or not text.strip():
        return 'unknown'
    
    # 统计各语言字符数量
    chinese_count = len(CHINESE_PATTERN.findall(text))
    japanese_count = len(JAPANESE_PATTERN.findall(text)) - chinese_count  # 减去汉字（因为中日共用）
    english_count = len(ENGLISH_PATTERN.findall(text))
    
    # 如果包含日文假名，优先判断为日语
    if japanese_count > 0:
        # 检查是否主要是日语（假名数量较多）
        hiragana_katakana = len(re.findall(r'[\u3040-\u309f\u30a0-\u30ff]', text))
        if hiragana_katakana > 0 and hiragana_katakana >= chinese_count * 0.3:
            return 'ja'
    
    # 判断主要语言
    if chinese_count > english_count and chinese_count > 0:
        return 'zh'
    elif japanese_count > 0 or (chinese_count > 0 and japanese_count > 0):
        return 'ja'
    elif english_count > 0:
        return 'en'
    else:
        return 'unknown'


async def translate_text(text: str, target_lang: str, source_lang: Optional[str] = None) -> str:
    """
    翻译文本到目标语言
    
    Args:
        text: 要翻译的文本
        target_lang: 目标语言代码 ('zh', 'en', 'ja')
        source_lang: 源语言代码，如果为None则自动检测
        
    Returns:
        翻译后的文本，如果翻译失败则返回原文
    """
    if not text or not text.strip():
        return text
    
    # 自动检测源语言
    if source_lang is None:
        source_lang = detect_language(text)
    
    # 如果源语言和目标语言相同，不需要翻译
    if source_lang == target_lang or source_lang == 'unknown':
        return text
    
    try:
        config_manager = get_config_manager()
        # 使用correction模型配置（轻量级模型，适合翻译任务）
        correction_config = config_manager.get_model_api_config('correction')
        
        # 语言名称映射
        lang_names = {
            'zh': '中文',
            'en': '英文',
            'ja': '日语'
        }
        
        source_name = lang_names.get(source_lang, source_lang)
        target_name = lang_names.get(target_lang, target_lang)
        
        llm = ChatOpenAI(
            model=correction_config['model'],
            base_url=correction_config['base_url'],
            api_key=correction_config['api_key'],
            temperature=0.3,  # 低temperature保证翻译准确性
            timeout=10.0
        )
        
        system_prompt = f"""你是一个专业的翻译助手。请将用户提供的文本从{source_name}翻译成{target_name}。

要求：
1. 保持原文的语气和风格
2. 准确传达原文的意思
3. 只输出翻译结果，不要添加任何解释或说明
4. 如果文本包含emoji或特殊符号，请保留它们"""
        
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=text)
        ]
        
        response = await llm.ainvoke(messages)
        translated_text = response.content.strip()
        
        logger.debug(f"翻译: {source_lang} -> {target_lang}: {text[:50]}... -> {translated_text[:50]}...")
        return translated_text
        
    except Exception as e:
        logger.error(f"翻译失败: {e}, 返回原文")
        return text


def get_user_language() -> str:
    """
    获取用户的语言偏好
    
    Returns:
        用户语言代码 ('zh', 'en', 'ja')，默认返回 'zh'
    """
    try:
        from main_routers.config_router import get_steam_language
        import asyncio
        
        # 尝试从Steam获取语言设置
        # 注意：这是一个同步函数，但get_steam_language是异步的
        # 我们需要在调用时处理这个异步问题
        # 这里先返回默认值，实际使用时会在异步上下文中调用
        return 'zh'  # 默认中文
    except Exception:
        return 'zh'  # 默认中文


async def get_user_language_async() -> str:
    """
    异步获取用户的语言偏好
    
    Returns:
        用户语言代码 ('zh', 'en', 'ja')，默认返回 'zh'
    """
    try:
        # 尝试从Steam获取语言设置
        from main_routers.shared_state import get_steamworks
        
        steamworks = get_steamworks()
        if steamworks is not None:
            # Steam 语言代码到我们的语言代码的映射
            STEAM_TO_LANG_MAP = {
                'schinese': 'zh',
                'tchinese': 'zh',
                'english': 'en',
                'japanese': 'ja',
                'ja': 'ja'
            }
            
            # 获取 Steam 当前游戏语言
            steam_language = steamworks.Apps.GetCurrentGameLanguage()
            if isinstance(steam_language, bytes):
                steam_language = steam_language.decode('utf-8')
            
            user_lang = STEAM_TO_LANG_MAP.get(steam_language, 'zh')
            logger.debug(f"从Steam获取用户语言: {steam_language} -> {user_lang}")
            return user_lang
    except Exception as e:
        logger.debug(f"获取用户语言失败: {e}, 使用默认中文")
    
    return 'zh'  # 默认中文


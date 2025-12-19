# -*- coding: utf-8 -*-
"""
语言检测和翻译工具模块
用于检测文本语言并翻译到目标语言
优先级：Google 翻译 -> LibreTranslate -> DeepL -> LLM 翻译
"""
import re
import logging
import asyncio
import aiohttp
from typing import Optional
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from utils.config_manager import get_config_manager

logger = logging.getLogger(__name__)

# 尝试导入 googletrans
try:
    from googletrans import Translator
    GOOGLETRANS_AVAILABLE = True
except ImportError:
    GOOGLETRANS_AVAILABLE = False
    logger.debug("googletrans 未安装，将跳过 Google 翻译")

# DeepL API 配置（从环境变量或配置文件中读取）
DEEPL_API_KEY = None
DEEPL_API_AVAILABLE = False

def init_deepl_api():
    """初始化 DeepL API 配置"""
    global DEEPL_API_KEY, DEEPL_API_AVAILABLE
    try:
        config_manager = get_config_manager()
        core_config = config_manager.get_core_config()
        # 从配置中读取 DeepL API key（如果配置了的话）
        DEEPL_API_KEY = core_config.get('DEEPL_API_KEY', '') or None
        if DEEPL_API_KEY:
            DEEPL_API_AVAILABLE = True
            logger.info("✅ DeepL API 已配置，将作为备选翻译方案")
        else:
            logger.debug("DeepL API key 未配置，将跳过 DeepL 翻译")
    except Exception as e:
        logger.debug(f"初始化 DeepL API 配置失败: {e}")

# 初始化 DeepL API
init_deepl_api()

# 语言检测正则表达式
CHINESE_PATTERN = re.compile(r'[\u4e00-\u9fff]')
JAPANESE_PATTERN = re.compile(r'[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9fff]')  # 平假名、片假名、汉字
ENGLISH_PATTERN = re.compile(r'[a-zA-Z]')


async def translate_with_libretranslate(text: str, source_lang: str, target_lang: str) -> Optional[str]:
    """
    使用 LibreTranslate 公共实例进行翻译（开源，免费，不需要 API key）
    
    Args:
        text: 要翻译的文本
        source_lang: 源语言代码（LibreTranslate格式，如 'zh', 'en', 'ja'）
        target_lang: 目标语言代码（LibreTranslate格式，如 'zh', 'en', 'ja'）
        
    Returns:
        翻译后的文本，失败时返回 None
    """
    if not text or not text.strip():
        return None
    
    # LibreTranslate 公共实例端点（多个备选）
    endpoints = [
        "https://libretranslate.de/translate",
        "https://translate.argosopentech.com/translate",
    ]
    
    payload = {
        'q': text,
        'source': source_lang if source_lang != 'auto' else 'auto',
        'target': target_lang,
        'format': 'text'
    }
    
    for endpoint in endpoints:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    endpoint,
                    json=payload,
                    headers={'Content-Type': 'application/json'},
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        data = await response.json()
                        translated_text = data.get('translatedText', '')
                        if translated_text:
                            return translated_text
        except Exception as e:
            logger.debug(f"LibreTranslate 端点 {endpoint} 失败: {e}")
            continue
    
    return None


async def translate_with_deepl(text: str, source_lang: Optional[str], target_lang: str) -> Optional[str]:
    """
    使用 DeepL API 进行翻译（免费，每月50万字符，不需要梯子）
    
    Args:
        text: 要翻译的文本
        source_lang: 源语言代码（DeepL格式，如 'ZH', 'EN', 'JA'），None 表示自动检测
        target_lang: 目标语言代码（DeepL格式，如 'ZH', 'EN', 'JA'）
        
    Returns:
        翻译后的文本，失败时返回 None
    """
    if not text or not text.strip() or not DEEPL_API_KEY:
        return None
    
    # DeepL API 端点（免费版使用 api-free.deepl.com）
    url = "https://api-free.deepl.com/v2/translate"
    
    # 构建请求参数
    data = {
        'auth_key': DEEPL_API_KEY,
        'text': text,
        'target_lang': target_lang
    }
    
    # 如果指定了源语言，添加到参数中
    if source_lang:
        data['source_lang'] = source_lang
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                url,
                data=data,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    translations = result.get('translations', [])
                    if translations and len(translations) > 0:
                        translated_text = translations[0].get('text', '')
                        if translated_text:
                            return translated_text
                else:
                    error_text = await response.text()
                    logger.debug(f"DeepL API 返回错误: {response.status} - {error_text}")
    except Exception as e:
        logger.debug(f"DeepL API 调用失败: {e}")
        raise
    
    return None


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
    优先级：Google 翻译 -> LibreTranslate -> DeepL -> LLM 翻译
    
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
    
    # 语言代码映射：我们的代码 -> Google Translate 代码
    GOOGLE_LANG_MAP = {
        'zh': 'zh-cn',  # 简体中文
        'en': 'en',
        'ja': 'ja'
    }
    
    google_target = GOOGLE_LANG_MAP.get(target_lang, target_lang)
    google_source = GOOGLE_LANG_MAP.get(source_lang, source_lang) if source_lang != 'unknown' else 'auto'
    
    # 优先级1：尝试使用 Google 翻译（免费，但可能需要梯子）
    if GOOGLETRANS_AVAILABLE:
        try:
            translator = Translator()
            # 如果文本太长（超过15k字符），分段翻译
            max_chunk_size = 15000
            if len(text) > max_chunk_size:
                # 分段翻译
                chunks = []
                current_chunk = ""
                for char in text:
                    current_chunk += char
                    if len(current_chunk) >= max_chunk_size:
                        # 尝试在句号、换行符等位置分割
                        last_period = max(
                            current_chunk.rfind('。'),
                            current_chunk.rfind('.'),
                            current_chunk.rfind('！'),
                            current_chunk.rfind('!'),
                            current_chunk.rfind('？'),
                            current_chunk.rfind('?'),
                            current_chunk.rfind('\n')
                        )
                        if last_period > max_chunk_size * 0.7:  # 如果找到合适的分割点
                            chunks.append(current_chunk[:last_period + 1])
                            current_chunk = current_chunk[last_period + 1:]
                        else:
                            chunks.append(current_chunk)
                            current_chunk = ""
                if current_chunk:
                    chunks.append(current_chunk)
                
                # 翻译每个分段（第一个分段使用auto检测，后续使用已检测的源语言）
                translated_chunks = []
                for i, chunk in enumerate(chunks):
                    # 第一个分段可以使用auto，后续分段使用已检测的源语言
                    chunk_source = google_source if i > 0 or source_lang != 'unknown' else 'auto'
                    # googletrans 4.0+ 的 translate 方法返回协程，需要使用 await
                    result = await translator.translate(chunk, src=chunk_source, dest=google_target)
                    translated_chunks.append(result.text)
                
                translated_text = ''.join(translated_chunks)
            else:
                # 单次翻译
                # googletrans 4.0+ 的 translate 方法返回协程，需要使用 await
                result = await translator.translate(text, src=google_source, dest=google_target)
                translated_text = result.text
            
            logger.info(f"✅ [翻译服务] Google翻译成功: {source_lang} -> {target_lang}")
            logger.debug(f"Google翻译结果预览: {text[:50]}... -> {translated_text[:50]}...")
            return translated_text
                
        except Exception as e:
            logger.debug(f"❌ [翻译服务] Google翻译失败: {type(e).__name__}: {e}，尝试 LibreTranslate 翻译")
            # 继续执行，尝试下一个方案
    
    # 优先级2：尝试使用 LibreTranslate 翻译（开源，免费，不需要 API key）
    try:
        # 语言代码映射：我们的代码 -> LibreTranslate API 代码
        LIBRETRANSLATE_LANG_MAP = {
            'zh': 'zh',
            'en': 'en',
            'ja': 'ja'
        }
        
        libre_target = LIBRETRANSLATE_LANG_MAP.get(target_lang, target_lang)
        libre_source = LIBRETRANSLATE_LANG_MAP.get(source_lang, source_lang) if source_lang != 'unknown' else 'auto'
        
        translated_text = await translate_with_libretranslate(text, libre_source, libre_target)
        if translated_text:
            logger.info(f"✅ [翻译服务] LibreTranslate翻译成功: {source_lang} -> {target_lang}")
            logger.debug(f"LibreTranslate翻译结果预览: {text[:50]}... -> {translated_text[:50]}...")
            return translated_text
    except Exception as e:
        logger.debug(f"❌ [翻译服务] LibreTranslate翻译失败: {type(e).__name__}: {e}，尝试 DeepL 翻译")
        # 继续执行，尝试下一个方案
    
    # 优先级3：尝试使用 DeepL 翻译（免费，每月50万字符，不需要梯子）
    if DEEPL_API_AVAILABLE and DEEPL_API_KEY:
        try:
            # 语言代码映射：我们的代码 -> DeepL API 代码
            DEEPL_LANG_MAP = {
                'zh': 'ZH',  # 简体中文
                'en': 'EN',
                'ja': 'JA'
            }
            
            deepl_target = DEEPL_LANG_MAP.get(target_lang, target_lang.upper())
            deepl_source = DEEPL_LANG_MAP.get(source_lang, source_lang.upper()) if source_lang != 'unknown' else None
            
            translated_text = await translate_with_deepl(text, deepl_source, deepl_target)
            if translated_text:
                logger.info(f"✅ [翻译服务] DeepL翻译成功: {source_lang} -> {target_lang}")
                logger.debug(f"DeepL翻译结果预览: {text[:50]}... -> {translated_text[:50]}...")
                return translated_text
        except Exception as e:
            logger.debug(f"❌ [翻译服务] DeepL翻译失败: {type(e).__name__}: {e}，回退到 LLM 翻译")
            # 继续执行，回退到LLM翻译
    
    # 优先级4：回退到 LLM 翻译
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
        
        logger.info(f"✅ [翻译服务] LLM翻译成功: {source_lang} -> {target_lang} (使用 {correction_config.get('model', 'unknown')} 模型)")
        logger.debug(f"LLM翻译结果预览: {text[:50]}... -> {translated_text[:50]}...")
        return translated_text
        
    except Exception as e:
        logger.error(f"LLM翻译也失败: {e}, 返回原文")
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


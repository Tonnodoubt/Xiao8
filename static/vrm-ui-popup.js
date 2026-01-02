/**
 * VRM UI Popup - 弹出框组件（与Live2D保持一致的交互逻辑）
 * 包含弹出框创建、设置菜单、开关项组件
 */

// 创建弹出框（与Live2D逻辑完全一致，仅ID前缀不同）
VRMManager.prototype.createPopup = function (buttonId) {
    const popup = document.createElement('div');
    popup.id = `vrm-popup-${buttonId}`;  // VRM专用ID
    popup.className = 'vrm-popup';

    Object.assign(popup.style, {
        position: 'absolute',
        left: '100%',
        top: '0',
        marginLeft: '8px',
        zIndex: '100000',  // 确保弹出菜单置顶，不被任何元素遮挡
        background: 'rgba(255, 255, 255, 0.65)',  // Fluent Acrylic
        backdropFilter: 'saturate(180%) blur(20px)',  // Fluent 标准模糊
        border: '1px solid rgba(255, 255, 255, 0.18)',  // 微妙高光边框
        borderRadius: '8px',  // Fluent 标准圆角
        padding: '8px',
        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.04), 0 8px 16px rgba(0, 0, 0, 0.08), 0 16px 32px rgba(0, 0, 0, 0.04)',  // Fluent 多层阴影
        display: 'none',
        flexDirection: 'column',
        gap: '6px',
        minWidth: '180px',
        maxHeight: '200px',
        overflowY: 'auto',
        pointerEvents: 'auto',
        opacity: '0',
        transform: 'translateX(-10px)',
        transition: 'opacity 0.2s cubic-bezier(0.1, 0.9, 0.2, 1), transform 0.2s cubic-bezier(0.1, 0.9, 0.2, 1)'  // Fluent 动画曲线
    });

    // 阻止弹出菜单上的指针事件传播，避免触发VRM拖拽
    const stopEventPropagation = (e) => {
        e.stopPropagation();
    };
    popup.addEventListener('pointerdown', stopEventPropagation, true);
    popup.addEventListener('pointermove', stopEventPropagation, true);
    popup.addEventListener('pointerup', stopEventPropagation, true);
    popup.addEventListener('mousedown', stopEventPropagation, true);
    popup.addEventListener('mousemove', stopEventPropagation, true);
    popup.addEventListener('mouseup', stopEventPropagation, true);
    popup.addEventListener('touchstart', stopEventPropagation, true);
    popup.addEventListener('touchmove', stopEventPropagation, true);
    popup.addEventListener('touchend', stopEventPropagation, true);

    // 根据不同按钮创建不同的弹出内容
    if (buttonId === 'mic') {
        // 麦克风选择列表（将从页面中获取）
        popup.id = 'vrm-popup-mic';
        popup.setAttribute('data-legacy-id', 'vrm-mic-popup');
    } else if (buttonId === 'agent') {
        // Agent工具开关组
        this._createAgentPopupContent(popup);
    } else if (buttonId === 'settings') {
        // 设置菜单
        this._createSettingsPopupContent(popup);
    }

    return popup;
};

// 创建Agent弹出框内容（与Live2D完全一致，仅ID前缀不同）
VRMManager.prototype._createAgentPopupContent = function (popup) {
    // 添加状态显示栏 - Fluent Design
    const statusDiv = document.createElement('div');
    statusDiv.id = 'vrm-agent-status';  // VRM专用ID
    Object.assign(statusDiv.style, {
        fontSize: '12px',
        color: '#44b7fe',
        padding: '6px 8px',
        borderRadius: '4px',
        background: 'rgba(68, 183, 254, 0.05)',
        marginBottom: '8px',
        minHeight: '20px',
        textAlign: 'center'
    });
    statusDiv.textContent = window.t ? window.t('settings.toggles.checking') : '查询中...';
    popup.appendChild(statusDiv);

    // 所有 agent 开关默认禁用
    const agentToggles = [
        {
            id: 'agent-master',
            label: window.t ? window.t('settings.toggles.agentMaster') : 'Agent总开关',
            labelKey: 'settings.toggles.agentMaster',
            initialDisabled: true,
            initialTitle: window.t ? window.t('settings.toggles.checking') : '查询中...'
        },
        {
            id: 'agent-keyboard',
            label: window.t ? window.t('settings.toggles.keyboardControl') : '键鼠控制',
            labelKey: 'settings.toggles.keyboardControl',
            initialDisabled: true,
            initialTitle: window.t ? window.t('settings.toggles.checking') : '查询中...'
        },
        {
            id: 'agent-mcp',
            label: window.t ? window.t('settings.toggles.mcpTools') : 'MCP工具',
            labelKey: 'settings.toggles.mcpTools',
            initialDisabled: true,
            initialTitle: window.t ? window.t('settings.toggles.checking') : '查询中...'
        },
        {
            id: 'agent-user-plugin',
            label: window.t ? window.t('settings.toggles.userPlugin') : '用户插件',
            labelKey: 'settings.toggles.userPlugin',
            initialDisabled: true,
            initialTitle: window.t ? window.t('settings.toggles.checking') : '查询中...'
        }
    ];

    agentToggles.forEach(toggle => {
        const toggleItem = this._createToggleItem(toggle, popup);
        popup.appendChild(toggleItem);
    });
};

// 创建设置弹出框内容（与Live2D完全一致）
VRMManager.prototype._createSettingsPopupContent = function (popup) {
    // 先添加 Focus 模式、主动搭话和自主视觉开关（在最上面）
    const settingsToggles = [
        { id: 'focus-mode', label: window.t ? window.t('settings.toggles.allowInterrupt') : '允许打断', labelKey: 'settings.toggles.allowInterrupt', storageKey: 'focusModeEnabled', inverted: true },
        { id: 'proactive-chat', label: window.t ? window.t('settings.toggles.proactiveChat') : '主动搭话', labelKey: 'settings.toggles.proactiveChat', storageKey: 'proactiveChatEnabled' },
        { id: 'proactive-vision', label: window.t ? window.t('settings.toggles.proactiveVision') : '自主视觉', labelKey: 'settings.toggles.proactiveVision', storageKey: 'proactiveVisionEnabled' }
    ];

    settingsToggles.forEach(toggle => {
        const toggleItem = this._createSettingsToggleItem(toggle, popup);
        popup.appendChild(toggleItem);
    });

    // 手机仅保留两个开关；桌面端追加导航菜单
    if (window.isMobileWidth && !window.isMobileWidth()) {
        // 添加分隔线
        const separator = document.createElement('div');
        Object.assign(separator.style, {
            height: '1px',
            background: 'rgba(0,0,0,0.1)',
            margin: '4px 0'
        });
        popup.appendChild(separator);

        // 然后添加导航菜单项
        this._createSettingsMenuItems(popup);
    }
};

// 创建Agent开关项（与Live2D完全一致，仅ID前缀不同）
VRMManager.prototype._createToggleItem = function (toggle, popup) {
    const toggleItem = document.createElement('div');
    Object.assign(toggleItem.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 8px',
        cursor: 'pointer',
        borderRadius: '6px',
        transition: 'background 0.2s ease, opacity 0.2s ease',
        fontSize: '13px',
        whiteSpace: 'nowrap',
        opacity: toggle.initialDisabled ? '0.5' : '1'
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `vrm-${toggle.id}`;  // VRM专用ID
    Object.assign(checkbox.style, {
        display: 'none'
    });

    if (toggle.initialDisabled) {
        checkbox.disabled = true;
        checkbox.title = toggle.initialTitle || (window.t ? window.t('settings.toggles.checking') : '查询中...');
        toggleItem.style.cursor = 'default';
    }

    // 创建自定义圆形指示器
    const indicator = document.createElement('div');
    Object.assign(indicator.style, {
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: '2px solid #ccc',
        backgroundColor: 'transparent',
        cursor: 'pointer',
        flexShrink: '0',
        transition: 'all 0.2s ease',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    });

    const checkmark = document.createElement('div');
    checkmark.innerHTML = '✓';
    Object.assign(checkmark.style, {
        color: '#fff',
        fontSize: '13px',
        fontWeight: 'bold',
        lineHeight: '1',
        opacity: '0',
        transition: 'opacity 0.2s ease',
        pointerEvents: 'none',
        userSelect: 'none'
    });
    indicator.appendChild(checkmark);

    const label = document.createElement('label');
    label.innerText = toggle.label;
    if (toggle.labelKey) {
        label.setAttribute('data-i18n', toggle.labelKey);
    }
    label.htmlFor = `vrm-${toggle.id}`;
    label.style.cursor = 'pointer';
    label.style.userSelect = 'none';
    label.style.fontSize = '13px';
    label.style.color = '#333';

    const updateLabelText = () => {
        if (toggle.labelKey && window.t) {
            label.innerText = window.t(toggle.labelKey);
        }
    };

    const updateTitle = () => {
        const title = checkbox.title || '';
        label.title = toggleItem.title = title;
    };

    const updateStyle = () => {
        if (checkbox.checked) {
            indicator.style.backgroundColor = '#44b7fe';
            indicator.style.borderColor = '#44b7fe';
            checkmark.style.opacity = '1';
        } else {
            indicator.style.backgroundColor = 'transparent';
            indicator.style.borderColor = '#ccc';
            checkmark.style.opacity = '0';
        }
    };

    const updateDisabledStyle = () => {
        const disabled = checkbox.disabled;
        const cursor = disabled ? 'default' : 'pointer';
        [toggleItem, label, indicator].forEach(el => el.style.cursor = cursor);
        toggleItem.style.opacity = disabled ? '0.5' : '1';
    };

    const disabledObserver = new MutationObserver(() => {
        updateDisabledStyle();
        if (checkbox.hasAttribute('title')) updateTitle();
    });
    disabledObserver.observe(checkbox, { attributes: true, attributeFilter: ['disabled', 'title'] });

    checkbox.addEventListener('change', updateStyle);

    updateStyle();
    updateDisabledStyle();
    updateTitle();

    toggleItem.appendChild(checkbox);
    toggleItem.appendChild(indicator);
    toggleItem.appendChild(label);

    checkbox._updateStyle = updateStyle;
    if (toggle.labelKey) {
        toggleItem._updateLabelText = updateLabelText;
    }

    toggleItem.addEventListener('mouseenter', () => {
        if (checkbox.disabled && checkbox.title?.includes('不可用')) {
            const statusEl = document.getElementById('vrm-agent-status');
            if (statusEl) statusEl.textContent = checkbox.title;
        } else if (!checkbox.disabled) {
            toggleItem.style.background = 'rgba(68, 183, 254, 0.1)';
        }
    });
    toggleItem.addEventListener('mouseleave', () => {
        toggleItem.style.background = 'transparent';
    });

    const handleToggle = (event) => {
        if (checkbox.disabled) return;

        if (checkbox._processing) {
            const elapsed = Date.now() - (checkbox._processingTime || 0);
            if (elapsed < 500) {
                console.log('[VRM] Agent开关正在处理中，忽略重复点击:', toggle.id, '已过', elapsed, 'ms');
                event?.preventDefault();
                event?.stopPropagation();
                return;
            }
            console.log('[VRM] Agent开关上次操作可能超时，允许新操作:', toggle.id);
        }

        checkbox._processing = true;
        checkbox._processingEvent = event;
        checkbox._processingTime = Date.now();

        const newChecked = !checkbox.checked;
        checkbox.checked = newChecked;
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        updateStyle();

        setTimeout(() => {
            if (checkbox._processing && Date.now() - checkbox._processingTime > 5000) {
                console.log('[VRM] Agent开关备用清除机制触发:', toggle.id);
                checkbox._processing = false;
                checkbox._processingEvent = null;
                checkbox._processingTime = null;
            }
        }, 5500);

        event?.preventDefault();
        event?.stopPropagation();
    };

    toggleItem.addEventListener('click', (e) => {
        if (e.target !== checkbox && e.target !== indicator && e.target !== label) {
            handleToggle(e);
        }
    });

    indicator.addEventListener('click', (e) => {
        e.stopPropagation();
        handleToggle(e);
    });

    label.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleToggle(e);
    });

    return toggleItem;
};

// 创建设置开关项（与Live2D完全一致，仅ID前缀不同）
VRMManager.prototype._createSettingsToggleItem = function (toggle, popup) {
    const toggleItem = document.createElement('div');
    Object.assign(toggleItem.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '8px 12px',
        cursor: 'pointer',
        borderRadius: '6px',
        transition: 'background 0.2s ease',
        fontSize: '13px',
        whiteSpace: 'nowrap',
        borderBottom: '1px solid rgba(0,0,0,0.05)'
    });

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `vrm-${toggle.id}`;  // VRM专用ID
    Object.assign(checkbox.style, {
        display: 'none'
    });

    // 从 window 获取当前状态
    if (toggle.id === 'focus-mode' && typeof window.focusModeEnabled !== 'undefined') {
        checkbox.checked = toggle.inverted ? !window.focusModeEnabled : window.focusModeEnabled;
    } else if (toggle.id === 'proactive-chat' && typeof window.proactiveChatEnabled !== 'undefined') {
        checkbox.checked = window.proactiveChatEnabled;
    } else if (toggle.id === 'proactive-vision' && typeof window.proactiveVisionEnabled !== 'undefined') {
        checkbox.checked = window.proactiveVisionEnabled;
    }

    const indicator = document.createElement('div');
    Object.assign(indicator.style, {
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        border: '2px solid #ccc',
        backgroundColor: 'transparent',
        cursor: 'pointer',
        flexShrink: '0',
        transition: 'all 0.2s ease',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
    });

    const checkmark = document.createElement('div');
    checkmark.innerHTML = '✓';
    Object.assign(checkmark.style, {
        color: '#fff',
        fontSize: '13px',
        fontWeight: 'bold',
        lineHeight: '1',
        opacity: '0',
        transition: 'opacity 0.2s ease',
        pointerEvents: 'none',
        userSelect: 'none'
    });
    indicator.appendChild(checkmark);

    const label = document.createElement('label');
    label.innerText = toggle.label;
    label.htmlFor = `vrm-${toggle.id}`;
    if (toggle.labelKey) {
        label.setAttribute('data-i18n', toggle.labelKey);
    }
    label.style.cursor = 'pointer';
    label.style.userSelect = 'none';
    label.style.fontSize = '13px';
    label.style.color = '#333';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.lineHeight = '1';
    label.style.height = '20px';

    const updateStyle = () => {
        if (checkbox.checked) {
            indicator.style.backgroundColor = '#44b7fe';
            indicator.style.borderColor = '#44b7fe';
            checkmark.style.opacity = '1';
            toggleItem.style.background = 'rgba(68, 183, 254, 0.1)';
        } else {
            indicator.style.backgroundColor = 'transparent';
            indicator.style.borderColor = '#ccc';
            checkmark.style.opacity = '0';
            toggleItem.style.background = 'transparent';
        }
    };

    updateStyle();

    toggleItem.appendChild(checkbox);
    toggleItem.appendChild(indicator);
    toggleItem.appendChild(label);

    toggleItem.addEventListener('mouseenter', () => {
        if (checkbox.checked) {
            toggleItem.style.background = 'rgba(68, 183, 254, 0.15)';
        } else {
            toggleItem.style.background = 'rgba(68, 183, 254, 0.08)';
        }
    });
    toggleItem.addEventListener('mouseleave', () => {
        updateStyle();
    });

    const handleToggleChange = (isChecked) => {
        updateStyle();

        if (toggle.id === 'focus-mode') {
            const actualValue = toggle.inverted ? !isChecked : isChecked;
            window.focusModeEnabled = actualValue;
            if (typeof window.saveNEKOSettings === 'function') {
                window.saveNEKOSettings();
            }
        } else if (toggle.id === 'proactive-chat') {
            window.proactiveChatEnabled = isChecked;
            if (typeof window.saveNEKOSettings === 'function') {
                window.saveNEKOSettings();
            }
            if (isChecked && typeof window.resetProactiveChatBackoff === 'function') {
                window.resetProactiveChatBackoff();
            } else if (!isChecked && typeof window.stopProactiveChatSchedule === 'function') {
                window.stopProactiveChatSchedule();
            }
            console.log(`主动搭话已${isChecked ? '开启' : '关闭'}`);
        } else if (toggle.id === 'proactive-vision') {
            window.proactiveVisionEnabled = isChecked;
            if (typeof window.saveNEKOSettings === 'function') {
                window.saveNEKOSettings();
            }
            if (isChecked) {
                if (typeof window.resetProactiveChatBackoff === 'function') {
                    window.resetProactiveChatBackoff();
                }
                if (typeof window.isRecording !== 'undefined' && window.isRecording) {
                    if (typeof window.startProactiveVisionDuringSpeech === 'function') {
                        window.startProactiveVisionDuringSpeech();
                    }
                }
            } else {
                if (typeof window.stopProactiveChatSchedule === 'function') {
                    if (!window.proactiveChatEnabled) {
                        window.stopProactiveChatSchedule();
                    }
                }
                if (typeof window.stopProactiveVisionDuringSpeech === 'function') {
                    window.stopProactiveVisionDuringSpeech();
                }
            }
            console.log(`主动视觉已${isChecked ? '开启' : '关闭'}`);
        }
    };

    checkbox.addEventListener('change', (e) => {
        e.stopPropagation();
        handleToggleChange(checkbox.checked);
    });

    toggleItem.addEventListener('click', (e) => {
        if (e.target !== checkbox && e.target !== indicator) {
            e.preventDefault();
            e.stopPropagation();
            const newChecked = !checkbox.checked;
            checkbox.checked = newChecked;
            handleToggleChange(newChecked);
        }
    });

    indicator.addEventListener('click', (e) => {
        e.stopPropagation();
        const newChecked = !checkbox.checked;
        checkbox.checked = newChecked;
        handleToggleChange(newChecked);
    });

    label.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const newChecked = !checkbox.checked;
        checkbox.checked = newChecked;
        handleToggleChange(newChecked);
    });

    return toggleItem;
};

// 创建设置菜单项（与Live2D完全一致）
VRMManager.prototype._createSettingsMenuItems = function (popup) {
    const settingsItems = [
        { id: 'vrm-manage', label: window.t ? window.t('settings.menu.modelSettings') : '模型管理', labelKey: 'settings.menu.modelSettings', icon: '/static/icons/live2d_settings_icon.png', action: 'navigate', urlBase: '/model_manager' },
        { id: 'api-keys', label: window.t ? window.t('settings.menu.apiKeys') : 'API密钥', labelKey: 'settings.menu.apiKeys', icon: '/static/icons/api_key_icon.png', action: 'navigate', url: '/api_key' },
        { id: 'character', label: window.t ? window.t('settings.menu.characterManage') : '角色管理', labelKey: 'settings.menu.characterManage', icon: '/static/icons/character_icon.png', action: 'navigate', url: '/chara_manager' },
        { id: 'voice-clone', label: window.t ? window.t('settings.menu.voiceClone') : '声音克隆', labelKey: 'settings.menu.voiceClone', icon: '/static/icons/voice_clone_icon.png', action: 'navigate', url: '/voice_clone' },
        { id: 'memory', label: window.t ? window.t('settings.menu.memoryBrowser') : '记忆浏览', labelKey: 'settings.menu.memoryBrowser', icon: '/static/icons/memory_icon.png', action: 'navigate', url: '/memory_browser' },
        { id: 'steam-workshop', label: window.t ? window.t('settings.menu.steamWorkshop') : '创意工坊', labelKey: 'settings.menu.steamWorkshop', icon: '/static/icons/Steam_icon_logo.png', action: 'navigate', url: '/steam_workshop_manager' },
    ];

    settingsItems.forEach(item => {
        const menuItem = document.createElement('div');
        Object.assign(menuItem.style, {
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            cursor: 'pointer',
            borderRadius: '6px',
            transition: 'background 0.2s ease',
            fontSize: '13px',
            whiteSpace: 'nowrap',
            color: '#333'
        });

        if (item.icon) {
            const iconImg = document.createElement('img');
            iconImg.src = item.icon;
            iconImg.alt = item.label;
            Object.assign(iconImg.style, {
                width: '24px',
                height: '24px',
                objectFit: 'contain',
                flexShrink: '0'
            });
            menuItem.appendChild(iconImg);
        }

        const labelText = document.createElement('span');
        labelText.textContent = item.label;
        if (item.labelKey) {
            labelText.setAttribute('data-i18n', item.labelKey);
        }
        Object.assign(labelText.style, {
            display: 'flex',
            alignItems: 'center',
            lineHeight: '1',
            height: '24px'
        });
        menuItem.appendChild(labelText);

        if (item.labelKey) {
            const updateLabelText = () => {
                if (window.t) {
                    labelText.textContent = window.t(item.labelKey);
                    if (item.icon && menuItem.querySelector('img')) {
                        menuItem.querySelector('img').alt = window.t(item.labelKey);
                    }
                }
            };
            menuItem._updateLabelText = updateLabelText;
        }

        menuItem.addEventListener('mouseenter', () => {
            menuItem.style.background = 'rgba(68, 183, 254, 0.1)';
        });
        menuItem.addEventListener('mouseleave', () => {
            menuItem.style.background = 'transparent';
        });

        menuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            if (item.action === 'navigate') {
                this._openSettingsWindows = this._openSettingsWindows || {};
                let finalUrl = item.url || item.urlBase;
                if (item.id === 'vrm-manage' && item.urlBase) {
                    const lanlanName = (window.lanlan_config && window.lanlan_config.lanlan_name) || '';
                    finalUrl = `${item.urlBase}?lanlan_name=${encodeURIComponent(lanlanName)}`;
                    if (window.closeAllSettingsWindows) {
                        window.closeAllSettingsWindows();
                    }
                    window.location.href = finalUrl;
                } else if (item.id === 'voice-clone' && item.url) {
                    const lanlanName = (window.lanlan_config && window.lanlan_config.lanlan_name) || '';
                    finalUrl = `${item.url}?lanlan_name=${encodeURIComponent(lanlanName)}`;

                    if (this._openSettingsWindows[finalUrl]) {
                        const existingWindow = this._openSettingsWindows[finalUrl];
                        if (existingWindow && !existingWindow.closed) {
                            existingWindow.focus();
                            return;
                        } else {
                            delete this._openSettingsWindows[finalUrl];
                        }
                    }

                    this.closeAllSettingsWindows();

                    const newWindow = window.open(finalUrl, '_blank', 'width=1000,height=800,menubar=no,toolbar=no,location=no,status=no');
                    if (newWindow) {
                        this._openSettingsWindows[finalUrl] = newWindow;
                    }
                } else {
                    if (this._openSettingsWindows[finalUrl]) {
                        const existingWindow = this._openSettingsWindows[finalUrl];
                        if (existingWindow && !existingWindow.closed) {
                            existingWindow.focus();
                            return;
                        } else {
                            delete this._openSettingsWindows[finalUrl];
                        }
                    }

                    this.closeAllSettingsWindows();

                    const newWindow = window.open(finalUrl, '_blank', 'width=1000,height=800,menubar=no,toolbar=no,location=no,status=no');
                    if (newWindow) {
                        this._openSettingsWindows[finalUrl] = newWindow;

                        const checkClosed = setInterval(() => {
                            if (newWindow.closed) {
                                delete this._openSettingsWindows[finalUrl];
                                clearInterval(checkClosed);
                            }
                        }, 500);
                    }
                }
            }
        });

        popup.appendChild(menuItem);
    });
};

// 关闭指定按钮对应的弹出框，并恢复按钮状态（与Live2D完全一致，仅ID前缀不同）
VRMManager.prototype.closePopupById = function (buttonId) {
    if (!buttonId) return false;
    this._floatingButtons = this._floatingButtons || {};
    this._popupTimers = this._popupTimers || {};
    const popup = document.getElementById(`vrm-popup-${buttonId}`);  // VRM专用ID
    if (!popup || popup.style.display !== 'flex') {
        return false;
    }

    // 如果是 agent 弹窗关闭，派发关闭事件（使用live2d-*事件名保持兼容）
    if (buttonId === 'agent') {
        window.dispatchEvent(new CustomEvent('live2d-agent-popup-closed'));
    }

    popup.style.opacity = '0';
    popup.style.transform = 'translateX(-10px)';
    setTimeout(() => {
        popup.style.display = 'none';
    }, 200);

    const buttonEntry = this._floatingButtons[buttonId];
    if (buttonEntry && buttonEntry.button) {
        buttonEntry.button.dataset.active = 'false';
        buttonEntry.button.style.background = 'rgba(255, 255, 255, 0.65)';

        if (buttonEntry.imgOff && buttonEntry.imgOn) {
            buttonEntry.imgOff.style.opacity = '1';
            buttonEntry.imgOn.style.opacity = '0';
        }
    }

    if (this._popupTimers[buttonId]) {
        clearTimeout(this._popupTimers[buttonId]);
        this._popupTimers[buttonId] = null;
    }

    return true;
};

// 关闭除当前按钮之外的所有弹出框（与Live2D完全一致，仅ID前缀不同）
VRMManager.prototype.closeAllPopupsExcept = function (currentButtonId) {
    const popups = document.querySelectorAll('[id^="vrm-popup-"]');  // VRM专用ID
    popups.forEach(popup => {
        const popupId = popup.id.replace('vrm-popup-', '');
        if (popupId !== currentButtonId && popup.style.display === 'flex') {
            this.closePopupById(popupId);
        }
    });
};

// 关闭所有通过 window.open 打开的设置窗口（与Live2D完全一致）
VRMManager.prototype.closeAllSettingsWindows = function (exceptUrl = null) {
    if (!this._openSettingsWindows) return;
    Object.keys(this._openSettingsWindows).forEach(url => {
        if (exceptUrl && url === exceptUrl) return;
        const winRef = this._openSettingsWindows[url];
        try {
            if (winRef && !winRef.closed) {
                winRef.close();
            }
        } catch (_) {
            // 忽略跨域导致的 close 异常
        }
        delete this._openSettingsWindows[url];
    });
};

// 显示弹出框（与Live2D完全一致，仅ID前缀不同）
VRMManager.prototype.showPopup = function (buttonId, popup) {
    // 🔥【新增】这行代码是关键！防止 _popupTimers 未定义导致的报错
    this._popupTimers = this._popupTimers || {};
    const isVisible = popup.style.display === 'flex' && popup.style.opacity === '1';

    if (this._popupTimers[buttonId]) {
        clearTimeout(this._popupTimers[buttonId]);
        this._popupTimers[buttonId] = null;
    }

    // 如果是设置弹出框，每次显示时更新开关状态
    if (buttonId === 'settings') {
        const focusCheckbox = popup.querySelector('#vrm-focus-mode');  // VRM专用ID
        const proactiveChatCheckbox = popup.querySelector('#vrm-proactive-chat');  // VRM专用ID

        const updateCheckboxStyle = (checkbox) => {
            if (!checkbox) return;
            const toggleItem = checkbox.parentElement;
            if (!toggleItem) return;

            const indicator = toggleItem.children[1];
            if (!indicator) return;

            const checkmark = indicator.firstElementChild;

            if (checkbox.checked) {
                indicator.style.backgroundColor = '#44b7fe';
                indicator.style.borderColor = '#44b7fe';
                if (checkmark) checkmark.style.opacity = '1';
                toggleItem.style.background = 'rgba(68, 183, 254, 0.1)';
            } else {
                indicator.style.backgroundColor = 'transparent';
                indicator.style.borderColor = '#ccc';
                if (checkmark) checkmark.style.opacity = '0';
                toggleItem.style.background = 'transparent';
            }
        };

        if (focusCheckbox && typeof window.focusModeEnabled !== 'undefined') {
            const newChecked = !window.focusModeEnabled;
            if (focusCheckbox.checked !== newChecked) {
                focusCheckbox.checked = newChecked;
                requestAnimationFrame(() => {
                    updateCheckboxStyle(focusCheckbox);
                });
            } else {
                requestAnimationFrame(() => {
                    updateCheckboxStyle(focusCheckbox);
                });
            }
        }

        if (proactiveChatCheckbox && typeof window.proactiveChatEnabled !== 'undefined') {
            const newChecked = window.proactiveChatEnabled;
            if (proactiveChatCheckbox.checked !== newChecked) {
                proactiveChatCheckbox.checked = newChecked;
                requestAnimationFrame(() => {
                    updateCheckboxStyle(proactiveChatCheckbox);
                });
            } else {
                requestAnimationFrame(() => {
                    updateCheckboxStyle(proactiveChatCheckbox);
                });
            }
        }
    }

    // 如果是 agent 弹窗，触发服务器状态检查事件（使用live2d-*事件名保持兼容）
    if (buttonId === 'agent' && !isVisible) {
        window.dispatchEvent(new CustomEvent('live2d-agent-popup-opening'));
    }

    if (isVisible) {
        popup.style.opacity = '0';
        popup.style.transform = 'translateX(-10px)';

        if (buttonId === 'agent') {
            window.dispatchEvent(new CustomEvent('live2d-agent-popup-closed'));
        }

        setTimeout(() => {
            popup.style.display = 'none';
            popup.style.left = '100%';
            popup.style.right = 'auto';
            popup.style.top = '0';
            popup.style.marginLeft = '8px';
            popup.style.marginRight = '0';
            if (buttonId === 'settings' || buttonId === 'agent') {
                popup.style.maxHeight = '200px';
                popup.style.overflowY = 'auto';
            }
        }, 200);
    } else {
        this.closeAllPopupsExcept(buttonId);

        popup.style.display = 'flex';
        popup.style.opacity = '0';
        popup.style.visibility = 'visible';

        if (buttonId === 'settings' || buttonId === 'agent') {
            popup.style.maxHeight = 'none';
            popup.style.overflowY = 'visible';
        }

        const images = popup.querySelectorAll('img');
        const imageLoadPromises = Array.from(images).map(img => {
            if (img.complete) {
                return Promise.resolve();
            }
            return new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 100);
            });
        });

        Promise.all(imageLoadPromises).then(() => {
            void popup.offsetHeight;

            requestAnimationFrame(() => {
                const popupRect = popup.getBoundingClientRect();
                const screenWidth = window.innerWidth;
                const screenHeight = window.innerHeight;
                const rightMargin = 20;
                const bottomMargin = 60;

                const popupRight = popupRect.right;
                if (popupRight > screenWidth - rightMargin) {
                    const button = document.getElementById(`vrm-btn-${buttonId}`);  // VRM专用ID
                    const buttonWidth = button ? button.offsetWidth : 48;
                    const gap = 8;

                    popup.style.left = 'auto';
                    popup.style.right = '0';
                    popup.style.marginLeft = '0';
                    popup.style.marginRight = `${buttonWidth + gap}px`;
                    popup.style.transform = 'translateX(10px)';
                }

                if (buttonId === 'settings' || buttonId === 'agent') {
                    const popupBottom = popupRect.bottom;
                    if (popupBottom > screenHeight - bottomMargin) {
                        const overflow = popupBottom - (screenHeight - bottomMargin);
                        const currentTop = parseInt(popup.style.top) || 0;
                        const newTop = currentTop - overflow;
                        popup.style.top = `${newTop}px`;
                    }
                }

                popup.style.visibility = 'visible';
                popup.style.opacity = '1';
                popup.style.transform = 'translateX(0)';
            });
        });

        if (buttonId !== 'settings' && buttonId !== 'agent' && buttonId !== 'mic') {
            this._popupTimers[buttonId] = setTimeout(() => {
                popup.style.opacity = '0';
                popup.style.transform = popup.style.right === '100%' ? 'translateX(10px)' : 'translateX(-10px)';
                setTimeout(() => {
                    popup.style.display = 'none';
                    popup.style.left = '100%';
                    popup.style.right = 'auto';
                    popup.style.top = '0';
                }, 200);
                this._popupTimers[buttonId] = null;
            }, 1000);
        }
    }
};

console.log('[VRM] VRM UI Popup 模块已加载');

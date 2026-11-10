import { App, PluginSettingTab, Setting } from "obsidian";
import { i18n } from "./i18n";
import type ObduPlugin from "./main";
import { BarStyle, SizeMode } from "./types";

export class ObduSettingTab extends PluginSettingTab {
	plugin: ObduPlugin;

	constructor(app: App, plugin: ObduPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): Array<{
		id: keyof ObduPlugin["settings"];
		name: string;
		description: string;
	}> {
		const s = i18n();
		return [
			{
				id: "defaultSizeMode",
				name: s.settingSizeModeName,
				description: s.settingSizeModeDesc,
			},
			{
				id: "defaultShowHidden",
				name: s.settingShowHiddenName,
				description: s.settingShowHiddenDesc,
			},
			{
				id: "defaultBarStyle",
				name: s.settingBarStyleName,
				description: s.settingBarStyleDesc,
			},
		];
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = i18n();

		new Setting(containerEl)
			.setName(s.settingSizeModeName)
			.setDesc(s.settingSizeModeDesc)
			.addDropdown((dd) =>
				dd
					.addOption("physical", s.settingSizeModePhysical)
					.addOption("logical", s.settingSizeModeLogical)
					.setValue(this.plugin.settings.defaultSizeMode)
					.onChange(async (val) => {
						this.plugin.settings.defaultSizeMode = val as SizeMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(s.settingShowHiddenName)
			.setDesc(s.settingShowHiddenDesc)
			.addToggle((tg) =>
				tg
					.setValue(this.plugin.settings.defaultShowHidden)
					.onChange(async (val) => {
						this.plugin.settings.defaultShowHidden = val;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(s.settingBarStyleName)
			.setDesc(s.settingBarStyleDesc)
			.addDropdown((dd) =>
				dd
					.addOption("both", s.settingBarStyleBoth)
					.addOption("bar", s.settingBarStyleBar)
					.addOption("percent", s.settingBarStylePercent)
					.addOption("none", s.settingBarStyleNone)
					.setValue(this.plugin.settings.defaultBarStyle)
					.onChange(async (val) => {
						this.plugin.settings.defaultBarStyle = val as BarStyle;
						await this.plugin.saveSettings();
					})
			);
	}
}

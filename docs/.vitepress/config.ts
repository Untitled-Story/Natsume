import { defineConfig } from 'vitepress';
import typedocSidebar from '../reference/api/typedoc-sidebar.json';

export default defineConfig({
  title: 'Natsume',
  description: '基于 PixiJS 与 WebGL2 的 Unity 特效 Web 运行库',
  lang: 'zh-CN',
  base: process.env.DOCS_BASE ?? '/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/introduction' },
      { text: '参考', link: '/reference/support' },
      { text: '贡献', link: '/contributing/development' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '开始',
          items: [
            { text: '简介', link: '/guide/introduction' },
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '核心概念', link: '/guide/concepts' },
          ],
        },
        {
          text: '基础',
          items: [
            { text: '加载与预检', link: '/guide/loading-packs' },
            { text: '创建实例', link: '/guide/instantiating' },
            { text: '播放与更新', link: '/guide/playback' },
            { text: '环境配置', link: '/guide/environments' },
            { text: '诊断与错误', link: '/guide/diagnostics' },
          ],
        },
        {
          text: '功能',
          items: [
            { text: '场景绘制', link: '/guide/rendering' },
            { text: '粒子系统', link: '/guide/particles' },
            { text: '动画', link: '/guide/animation' },
            { text: 'Timeline', link: '/guide/timeline' },
            { text: '宿主行为与 Script Bridge', link: '/guide/behaviors' },
          ],
        },
      ],
      '/reference/': [
        {
          text: '参考',
          items: [
            { text: '支持范围', link: '/reference/support' },
            { text: 'Unity 行为差异', link: '/reference/unity-differences' },
            { text: '包格式', link: '/reference/package-format' },
          ],
        },
        { text: 'API 参考', link: '/reference/api/', items: typedocSidebar },
      ],
      '/contributing/': [
        {
          text: '贡献',
          items: [
            { text: '开发环境', link: '/contributing/development' },
            { text: '架构', link: '/contributing/architecture' },
            { text: '测试与验证', link: '/contributing/testing' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Untitled-Story/Natsume' }],
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '没有找到相关结果',
            resetButtonTitle: '清除查询',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },
    outline: { label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    lastUpdated: { text: '最后更新' },
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
    darkModeSwitchLabel: '外观',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    footer: { message: '基于 Apache License 2.0 发布', copyright: 'Natsume' },
  },
});

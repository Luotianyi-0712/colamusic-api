/**
 * 酷我音乐适配器
 */

import { 
  Platform, 
  SearchQuery, 
  SearchResult, 
  SongDetail, 
  LyricData, 
  AudioQuality,
  SongInfo,
  AudioUrls,
  AdapterConfig
} from '../types';
import { BasePlatformAdapter } from '../core/BasePlatformAdapter';
import { logger } from '../lib/logger';

export class KuwoAdapter extends BasePlatformAdapter {
  constructor(config: AdapterConfig) {
    super(Platform.KUWO, config);
  }

  /**
   * 搜索歌曲
   */
  async search(query: SearchQuery): Promise<SearchResult> {
    const cacheKey = this.generateCacheKey('search', query.keyword, String(query.limit || 20));
    
    // 尝试从缓存获取
    const cached = await this.getFromCache<SearchResult>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const startTime = Date.now();
    
    try {
      // 使用备用搜索接口
      return await this.searchFallback(query, startTime);
    } catch (error) {
      throw this.handleApiError(error, 'search');
    }
  }

  /**
   * 备用搜索接口
   */
  private async searchFallback(query: SearchQuery, startTime: number): Promise<SearchResult> {
    // 使用备用搜索接口
    const url = `https://www.kuwo.cn/openapi/v1/www/search/searchKey?key=${encodeURIComponent(query.keyword)}&httpsStatus=1&reqId=${this.generateUUID()}&plat=web_www&from=`;

    const headers = {
      'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.kuwo.cn/search/list',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    };

    logger.info('Making Kuwo fallback API request:', { url, headers });

    const response = await this.httpClient.get(url, { headers });
    
    logger.info('Kuwo fallback search response:', response);

    if (!response || !response.data) {
      throw new Error('Invalid response from Kuwo API');
    }

    // 检查响应状态
    if (response.code !== 200 && response.data.code !== 200) {
      throw new Error(`Kuwo API error: ${response.message || 'Unknown error'}`);
    }

    // 酷我音乐的备用API返回的是搜索建议，不是歌曲列表
    // 我们需要解析这些建议并提取歌曲信息
    if (!response.data || !Array.isArray(response.data)) {
      logger.warn('No search suggestions found in Kuwo response');
      return {
        status: 200,
        platform: Platform.KUWO,
        total: 0,
        hasMore: false,
        results: [],
        responseTime: Date.now() - startTime,
      };
    }

    // 解析搜索建议，提取歌曲相关的建议
    const suggestions = response.data.filter((item: string) => {
      return item.includes('RELWORD=') && !item.includes('MV') && !item.includes('演唱会') && !item.includes('伴奏') && !item.includes('歌单') && !item.includes('Live');
    });

    // 应用分页
    const offset = query.offset || 0;
    const limit = query.limit || 20;
    const paginatedSuggestions = suggestions.slice(offset, offset + limit);

    // 将搜索建议转换为虚拟歌曲条目
    const songs: SongInfo[] = paginatedSuggestions.map((item: string, index: number) => {
      const match = item.match(/RELWORD=([^\r\n]+)/);
      const songName = match ? match[1].trim() : `搜索建议 ${index + 1}`;
      
      // 尝试从建议中提取艺术家信息
      let artist = '未知歌手';
      let title = songName;
      
      if (songName.includes('  ')) {
        const parts = songName.split('  ');
        if (parts.length >= 2) {
          artist = parts[0];
          title = parts[1];
        }
      } else if (songName.includes(' - ')) {
        const parts = songName.split(' - ');
        if (parts.length >= 2) {
          artist = parts[0];
          title = parts[1];
        }
      }

      return {
        id: `kuwo_suggestion_${index}`,
        name: title,
        artists: [artist],
        album: '未知专辑',
        duration: 0,
        platform: Platform.KUWO,
        picUrl: '',
        platformData: {
          suggestion: songName,
          originalData: item
        },
      };
    });

    const total = suggestions.length;
    const result: SearchResult = {
      status: 200,
      platform: Platform.KUWO,
      total: total,
      hasMore: (offset + limit) < total,
      results: songs,
      responseTime: Date.now() - startTime,
    };

    // 缓存结果
    const cacheKey = this.generateCacheKey('search', query.keyword, String(query.limit || 20));
    await this.setToCache(cacheKey, result);
    
    logger.info(`Kuwo search completed: ${songs.length} results for "${query.keyword}"`);
    return result;
  }

  /**
   * 获取歌曲详情
   */
  async getSong(songId: string, quality: AudioQuality = AudioQuality.STANDARD): Promise<SongDetail> {
    const cacheKey = this.generateCacheKey('song', songId, quality);
    
    // 尝试从缓存获取
    const cached = await this.getFromCache<SongDetail>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }

    const startTime = Date.now();

    try {
      // 并行获取歌曲URL和歌词
      const [urlData, lyricData] = await Promise.all([
        this.fetchSongUrl(songId),
        this.getLyric(songId),
      ]);

      if (!urlData.data || !urlData.data.url) {
        throw new Error('Song URL not available');
      }

      const songData = urlData.data;

      const song: SongInfo = {
        id: songId,
        name: songData.songName || '',
        artists: [songData.artist || ''],
        album: songData.album || '',
        albumId: String(songData.albumId || ''),
        picUrl: (songData.pic || songData.albumpic || '').replace('http://', 'https://'),
        duration: (songData.duration || 0) * 1000,
        platform: Platform.KUWO,
        platformData: {
          pay: songData.pay,
          isstar: songData.isstar,
        },
      };

      const urls: AudioUrls = {
        [quality]: {
          url: songData.url.replace('http://', 'https://'),
          bitrate: this.getBitrateFromQuality(quality),
          format: this.getFormatFromUrl(songData.url),
        },
      };

      const result: SongDetail = {
        status: 200,
        platform: Platform.KUWO,
        song,
        urls,
        lyric: lyricData,
        responseTime: Date.now() - startTime,
      };

      // 缓存结果
      await this.setToCache(cacheKey, result);
      
      return result;
    } catch (error) {
      throw this.handleApiError(error, 'getSong');
    }
  }

  /**
   * 获取歌词
   */
  async getLyric(songId: string): Promise<LyricData> {
    const cacheKey = this.generateCacheKey('lyric', songId);
    
    // 尝试从缓存获取
    const cached = await this.getFromCache<LyricData>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // 歌词接口
      const url = `https://www.kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${songId}&httpsStatus=1&reqId=${this.generateUUID()}&plat=web_www&from=`;

      const headers = {
        'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': `https://www.kuwo.cn/play_detail/${songId}`,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cookie': this.config.cookies || '',
      };

      const response = await this.httpClient.get(url, { headers });

      const lyricData: LyricData = {
        original: response.data?.data?.lrclist ? this.formatKuwoLyric(response.data.data.lrclist) :
                  response.data?.lrclist ? this.formatKuwoLyric(response.data.lrclist) : '',
        translated: '',
        timeline: response.data?.data?.lrclist ? this.parseKuwoLyricTimeline(response.data.data.lrclist) :
                  response.data?.lrclist ? this.parseKuwoLyricTimeline(response.data.lrclist) : [],
      };

      // 缓存歌词
      await this.setToCache(cacheKey, lyricData);
      
      return lyricData;
    } catch (error) {
      logger.warn(`Failed to get lyric for song ${songId}:`, error);
      return {
        original: '',
        translated: '',
        timeline: [],
      };
    }
  }

  /**
   * 获取歌曲播放URL
   */
  private async fetchSongUrl(songId: string): Promise<any> {
    // 播放URL接口
    const url = `https://www.kuwo.cn/api/v1/www/music/playUrl?mid=${songId}&type=music&httpsStatus=1&reqId=${this.generateUUID()}&plat=web_www&from=`;

    const headers = {
      'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Referer': `https://www.kuwo.cn/play_detail/${songId}`,
      'Host': 'www.kuwo.cn',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cookie': this.config.cookies || '',
      // 需要secret头部，这里使用固定值或从配置获取
      'secret': await this.generateSecret(),
    };

    return this.httpClient.get(url, { headers });
  }

  /**
   * 生成UUID
   */
  private generateUUID(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * 生成secret
  */
  private async generateSecret(): Promise<string> {
    try {
      // 从cookie中获取Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324值
      const cookieValue = this.extractCookieValue('Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324');
      if (!cookieValue) {
        // 如果没有cookie值，生成一个默认的cookie值
        const defaultCookie = this.generateDefaultCookieValue();
        const m = 'Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324';
        return this.generateKuwoSecret(defaultCookie, m);
      }
      
      const m = 'Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324';
      return this.generateKuwoSecret(cookieValue, m);
    } catch (error) {
      logger.warn('Failed to generate Kuwo secret, using simple default:', error);
      return '';
    }
  }

  /**
   * 生成默认的cookie值
   */
  private generateDefaultCookieValue(): string {
    const timestamp = Date.now().toString();
    return timestamp.substring(timestamp.length - 10);
  }

  /**
   * 从cookie字符串中提取指定值
   */
  private extractCookieValue(name: string): string {
    const cookies = this.config.cookies || '';
    const match = cookies.match(new RegExp(`${name}=([^;]+)`));
    return match ? match[1] : '';
  }

  /**
   * 酷我secret生成算法
   */
  private generateKuwoSecret(t: string, e: string): string {
    if (!e || e.length <= 0) return '';
    
    let n = "";
    for (let i = 0; i < e.length; i++) {
      n += e.charCodeAt(i).toString();
    }
    
    const o = Math.floor(n.length / 5);
    const r = parseInt(n.charAt(o) + n.charAt(2 * o) + n.charAt(3 * o) + n.charAt(4 * o) + n.charAt(5 * o));
    const c = Math.ceil(e.length / 2);
    const l = Math.pow(2, 31) - 1;
    
    if (r < 2) return '';
    
    let d = Math.round(1e9 * Math.random()) % 1e8;
    n += d.toString();
    
    while (n.length > 10) {
      n = (parseInt(n.substring(0, 10)) + parseInt(n.substring(10, n.length))).toString();
    }
    
    let nValue = (r * parseInt(n) + c) % l;
    let h = "";
    
    for (let i = 0; i < t.length; i++) {
      const f = parseInt(t.charCodeAt(i).toString()) ^ Math.floor(nValue / l * 255);
      h += f < 16 ? "0" + f.toString(16) : f.toString(16);
      nValue = (r * nValue + c) % l;
    }
    
    let dHex = d.toString(16);
    while (dHex.length < 8) {
      dHex = "0" + dHex;
    }
    
    return h + dHex;
  }

  /**
   * 格式化酷我歌词
   */
  private formatKuwoLyric(lrclist: any[]): string {
    if (!Array.isArray(lrclist)) return '';
    
    return lrclist.map(item => {
      const time = this.formatTime(parseFloat(item.time));
      return `[${time}]${item.lineLyric || ''}`;
    }).join('\n');
  }

  /**
   * 解析酷我歌词时间轴
   */
  private parseKuwoLyricTimeline(lrclist: any[]): Array<{ time: number; text: string }> {
    if (!Array.isArray(lrclist)) return [];
    
    return lrclist.map(item => ({
      time: parseFloat(item.time) * 1000, // 转换为毫秒
      text: item.lineLyric || '',
    })).filter(item => item.text.trim());
  }

  /**
   * 格式化时间为LRC格式
   */
  private formatTime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }

  /**
   * 根据质量获取比特率
   */
  private getBitrateFromQuality(quality: AudioQuality): string {
    const qualityMap: Record<AudioQuality, string> = {
      [AudioQuality.STANDARD]: '128kbps',
      [AudioQuality.HIGH]: '320kbps',
      [AudioQuality.LOSSLESS]: 'FLAC',
      [AudioQuality.HIRES]: 'Hi-Res',
      [AudioQuality.MASTER]: 'Master',
    };
    return qualityMap[quality] || '128kbps';
  }

  /**
   * 从URL获取格式
   */
  private getFormatFromUrl(url: string): string {
    const match = url.match(/\.(\w+)(?:\?|$)/);
    return match ? match[1] : 'mp3';
  }
}
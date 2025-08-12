/**
 * QQ音乐API工具函数
 * 基于逆向工程的QQ音乐接口实现
 */

import crypto from 'crypto';

/**
 * QQ音乐签名算法
 * 基于逆向实现
 */
export class QQMusicSigner {
  private static instance: QQMusicSigner;
  
  public static getInstance(): QQMusicSigner {
    if (!QQMusicSigner.instance) {
      QQMusicSigner.instance = new QQMusicSigner();
    }
    return QQMusicSigner.instance;
  }

  /**
   * 生成QQ音乐API签名
   * @param data 要签名的数据
   * @returns 签名字符串
   */
  public sign(data: any): string {
    try {
      // 简化的签名算法，基于原始sign.js的核心逻辑
      const jsonStr = JSON.stringify(data);
      const hash = crypto.createHash('md5').update(jsonStr).digest('hex');
      
      // 模拟原始算法的部分逻辑
      let result = 0;
      for (let i = 0; i < hash.length; i++) {
        result = (result << 5) + result + hash.charCodeAt(i);
        result = result & 0x7fffffff; // 保持在32位整数范围内
      }
      
      return result.toString();
    } catch (error) {
      console.error('QQ Music sign error:', error);
      return Math.random().toString(36).substring(2);
    }
  }

  /**
   * 生成g_tk值
   * @param cookie Cookie字符串
   * @returns g_tk值
   */
  public generateGTK(cookie: string = ''): number {
    let n = 5381;
    
    // 从cookie中提取qm_keyst
    const qmKeyst = this.extractQmKeyst(cookie);
    
    if (qmKeyst) {
      for (let r = 0; r < qmKeyst.length; r++) {
        n += (n << 5) + qmKeyst.charCodeAt(r);
      }
    }
    
    return 2147483647 & n;
  }

  /**
   * 从cookie中提取qm_keyst值
   * @param cookie Cookie字符串
   * @returns qm_keyst值
   */
  private extractQmKeyst(cookie: string): string | null {
    if (!cookie) return null;
    
    const match = cookie.match(/qm_keyst=([^;]+)/);
    return match ? match[1] : null;
  }
}

/**
 * QQ音乐API请求构建器
 */
export class QQMusicRequestBuilder {
  private signer: QQMusicSigner;

  constructor() {
    this.signer = QQMusicSigner.getInstance();
  }

  /**
   * 生成签名
   * @param data 要签名的数据
   * @returns 签名字符串
   */
  public generateSign(data: string): string {
    return this.signer.sign(data);
  }

  /**
   * 构建搜索请求数据
   * @param keyword 搜索关键词
   * @param page 页码，从0开始
   * @param pageSize 每页数量
   * @returns 请求数据
   */
  public buildSearchRequest(keyword: string, page: number = 0, pageSize: number = 20) {
    const timestamp = Date.now();
    
    const requestData = {
      comm: {
        ct: 24,
        cv: 0,
        g_tk: this.signer.generateGTK(),
        uin: 0,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'h5',
        needNewCode: 1,
        _: timestamp
      },
      req_1: {
        method: 'DoSearchForQQMusicDesktop',
        module: 'music.search.SearchCgiService',
        param: {
          remoteplace: 'txt.mqq.all',
          searchid: timestamp.toString(),
          t: 0,
          aggr: 1,
          cr: 1,
          catZhida: 1,
          lossless: 0,
          flag_qc: 0,
          p: page + 1, // QQ音乐页码从1开始
          n: pageSize,
          w: keyword,
          g_tk_new_20200303: this.signer.generateGTK(),
          loginUin: 0,
          hostUin: 0,
          format: 'json',
          inCharset: 'utf8',
          outCharset: 'utf8',
          notice: 0,
          platform: 'yqq.json',
          needNewCode: 0
        }
      }
    };

    return requestData;
  }

  /**
   * 构建歌词请求数据
   * @param songmid 歌曲mid
   * @returns 请求数据
   */
  public buildLyricRequest(songmid: string) {
    const timestamp = Date.now();
    
    const requestData = {
      comm: {
        ct: 24,
        cv: 0,
        g_tk: this.signer.generateGTK(),
        uin: 0,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'h5',
        needNewCode: 1,
        _: timestamp
      },
      req_1: {
        method: 'GetPlayLyricInfo',
        module: 'music.musichallSong.PlayLyricInfo',
        param: {
          songMID: songmid,
          songID: 0
        }
      }
    };

    return requestData;
  }

  /**
   * 构建播放URL请求数据
   * @param songmid 歌曲mid
   * @param quality 音质等级
   * @returns 请求数据
   */
  public buildPlayUrlRequest(songmid: string, quality: string = 'M500') {
    const timestamp = Date.now();
    const guid = Math.floor(Math.random() * 10000000000);
    
    const requestData = {
      comm: {
        ct: 24,
        cv: 0,
        g_tk: this.signer.generateGTK(),
        uin: 0,
        format: 'json',
        inCharset: 'utf-8',
        outCharset: 'utf-8',
        notice: 0,
        platform: 'h5',
        needNewCode: 1,
        _: timestamp
      },
      req_1: {
        method: 'GetUrl',
        module: 'music.vkey.GetEVkey',
        param: {
          guid: guid.toString(),
          songmid: [songmid],
          songtype: [0],
          uin: '0',
          loginflag: 1,
          platform: '20',
          filename: [`${quality}${songmid}.mp3`]
        }
      }
    };

    return requestData;
  }

  /**
   * 构建请求URL
   * @param data 请求数据
   * @returns 完整的请求URL
   */
  public buildRequestUrl(data: any): string {
    const baseUrl = 'https://u6.y.qq.com/cgi-bin/musics.fcg';
    const sign = this.signer.sign(data);
    
    const params = new URLSearchParams({
      sign: sign,
      format: 'json',
      data: JSON.stringify(data)
    });

    return `${baseUrl}?${params.toString()}`;
  }
}

/**
 * QQ音乐API常量
 */
export const QQ_MUSIC_CONSTANTS = {
  BASE_URL: 'https://u6.y.qq.com/cgi-bin/musics.fcg',
  USER_AGENT: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  REFERER: 'https://y.qq.com/',
  
  // 音质映射
  QUALITY_MAP: {
    'low': 'M500',      // 128kbps
    'standard': 'M800', // 320kbps
    'high': 'F000',     // FLAC
    'lossless': 'A000'  // APE
  },
  
  // 错误码映射
  ERROR_CODES: {
    0: 'success',
    1: 'parameter error',
    2: 'system error',
    3: 'no permission',
    4: 'no data',
    5: 'network error'
  }
};

/**
 * 解析QQ音乐API响应
 * @param response API响应数据
 * @returns 解析后的数据
 */
export function parseQQMusicResponse(response: any) {
  // 如果响应为空或无效，返回null而不是抛出错误
  if (!response || typeof response !== 'object') {
    console.log('QQ Music API returned empty or invalid response:', response);
    return null;
  }

  // 检查通用错误
  if (response.code !== undefined && response.code !== 0) {
    const errorMsg = QQ_MUSIC_CONSTANTS.ERROR_CODES[response.code as keyof typeof QQ_MUSIC_CONSTANTS.ERROR_CODES] || 'Unknown error';
    throw new Error(`QQ Music API error: ${errorMsg} (code: ${response.code})`);
  }

  // 检查req_1响应
  if (response.req_1) {
    if (response.req_1.code !== 0) {
      const errorMsg = QQ_MUSIC_CONSTANTS.ERROR_CODES[response.req_1.code as keyof typeof QQ_MUSIC_CONSTANTS.ERROR_CODES] || 'Unknown error';
      throw new Error(`QQ Music API error: ${errorMsg} (code: ${response.req_1.code})`);
    }
    return response.req_1.data;
  }

  return response;
}
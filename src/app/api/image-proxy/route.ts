/* eslint-disable @typescript-eslint/no-explicit-any */

import { HttpsProxyAgent } from 'https-proxy-agent';
import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

function isCloudflareEnvironment(): boolean {
  return (
    process.env.CF_PAGES === '1' || process.env.BUILD_TARGET === 'cloudflare'
  );
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function applyBangumiImageBaseUrl(
  imageUrl: string,
  imageBaseUrl?: string
): string {
  const normalizedBaseUrl = normalizeBaseUrl(imageBaseUrl || '');
  if (!normalizedBaseUrl) {
    return imageUrl;
  }

  if (imageUrl.startsWith(`${normalizedBaseUrl}/`)) {
    return imageUrl;
  }

  return `${normalizedBaseUrl}/${imageUrl}`;
}

function isBangumiImageUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      hostname === 'lain.bgm.tv' ||
      hostname === 'r.bgm.tv' ||
      hostname.endsWith('.bgm.tv') ||
      hostname.endsWith('.bangumi.tv')
    );
  } catch {
    return false;
  }
}

// 创建一个带超时的 fetch 函数
async function fetchWithTimeout(
  url: string,
  options: any,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function fetchImage(
  imageUrl: string,
  options?: { source?: string }
): Promise<Response> {
  const isBangumiImage =
    options?.source === 'bangumi' || isBangumiImageUrl(imageUrl);
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    Referer: isBangumiImage ? 'https://bgm.tv/' : 'https://movie.douban.com/',
  };

  const config = isBangumiImage ? await getConfig() : null;
  const targetUrl = isBangumiImage
    ? applyBangumiImageBaseUrl(imageUrl, config?.SiteConfig.BangumiImageBaseUrl)
    : imageUrl;

  // Cloudflare 环境或非 Bangumi 图片，直接使用原生 fetch
  if (!isBangumiImage || isCloudflareEnvironment()) {
    return fetchWithTimeout(targetUrl, { headers }, 15000);
  }

  // 使用代理的情况
  const proxy = config?.SiteConfig.BangumiProxy?.trim();
  
  if (!proxy) {
    return fetchWithTimeout(targetUrl, { headers }, 15000);
  }

  // 使用代理时，需要用 node-fetch 或原生 fetch 配合代理
  // 注意：Node.js 18+ 原生 fetch 不支持 agent 参数，所以需要特殊处理
  const https = require('https');
  const { URL } = require('url');
  
  const urlObj = new URL(targetUrl);
  const agent = new HttpsProxyAgent(proxy, {
    timeout: 30000,
    keepAlive: false,
  });
  
  return new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
      agent,
    };
    
    const protocol = urlObj.protocol === 'https:' ? https : require('http');
    const req = protocol.request(requestOptions, (res: any) => {
      // 将 IncomingMessage 转换为 Response 对象
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        const response = new Response(body, {
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: new Headers(res.headers),
        });
        resolve(response);
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.end();
  });
}

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');
  const source = searchParams.get('source') || undefined;

  if (!imageUrl) {
    return NextResponse.json({ error: 'Missing image URL' }, { status: 400 });
  }

  try {
    const imageResponse = await fetchImage(imageUrl, { source });

    if (!imageResponse.ok) {
      console.error(`图片获取失败: ${imageUrl}, 状态码: ${imageResponse.status}`);
      // 返回一个占位图而不是错误
      return NextResponse.json(
        { error: `Failed to fetch image: ${imageResponse.statusText}` },
        { status: imageResponse.status }
      );
    }

    const contentType = imageResponse.headers.get('content-type');
    
    if (!contentType || !contentType.startsWith('image/')) {
      console.error(`无效的内容类型: ${contentType}, URL: ${imageUrl}`);
      return NextResponse.json(
        { error: 'Invalid content type' },
        { status: 500 }
      );
    }

    // 获取图片数据
    const imageBuffer = await imageResponse.arrayBuffer();
    
    // 创建响应头
    const headers = new Headers({
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, s-maxage=86400', // 缓存1天
      'CDN-Cache-Control': 'public, s-maxage=86400',
    });

    // 返回图片数据
    return new Response(imageBuffer, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error('图片代理请求失败:', {
      url: imageUrl,
      source,
      error: error.message,
      stack: error.stack,
    });
    
    // 返回一个透明的占位图或错误提示
    return NextResponse.json(
      { 
        error: 'Error fetching image',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

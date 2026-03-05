/**
 * Translation Service for NovaSupport
 * Wraps Amazon Translate to detect language and translate ticket content.
 *
 * Requirements: 5.1 (detect language), 5.6 (failure handling), 5.8 (TranslateText API with auto-detection)
 */

import { TranslateClient, TranslateTextCommand } from '@aws-sdk/client-translate';
import { createLogger } from '../utils/logger';

const logger = createLogger('TranslationService');

const translateClient = new TranslateClient({});

/**
 * Result of a translation operation.
 */
export interface TranslationResult {
  originalText: string;
  detectedLanguage: string;
  translatedText: string;
  targetLanguage: string;
  translationFailed?: boolean;
}

/**
 * Detect the source language and translate text to the target language
 * using Amazon Translate's TranslateText API with auto-detection.
 *
 * If the detected language matches the target language, the original text
 * is returned without calling the translate API unnecessarily.
 *
 * On failure, returns the original text with `translationFailed: true`.
 *
 * @param text - The text to translate
 * @param targetLang - Target language code (defaults to 'en')
 * @returns TranslationResult with original and translated text
 */
export async function detectAndTranslate(
  text: string,
  targetLang: string = 'en'
): Promise<TranslationResult> {
  try {
    const command = new TranslateTextCommand({
      Text: text,
      SourceLanguageCode: 'auto',
      TargetLanguageCode: targetLang,
    });

    const response = await translateClient.send(command);

    const detectedLanguage = response.SourceLanguageCode ?? 'unknown';
    const translatedText = response.TranslatedText ?? text;

    // If source and target are the same, return original text
    if (detectedLanguage === targetLang) {
      logger.info('Source language matches target, skipping translation', {
        detectedLanguage,
        targetLang,
      });
      return {
        originalText: text,
        detectedLanguage,
        translatedText: text,
        targetLanguage: targetLang,
      };
    }

    logger.info('Translation completed', {
      detectedLanguage,
      targetLang,
      originalLength: text.length,
      translatedLength: translatedText.length,
    });

    return {
      originalText: text,
      detectedLanguage,
      translatedText,
      targetLanguage: targetLang,
    };
  } catch (error: any) {
    logger.error('Translation failed', error, {
      targetLang,
      textLength: text.length,
    });

    return {
      originalText: text,
      detectedLanguage: 'unknown',
      translatedText: text,
      targetLanguage: targetLang,
      translationFailed: true,
    };
  }
}

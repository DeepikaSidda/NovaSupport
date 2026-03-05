/**
 * Unit tests for Knowledge Base Service
 * Tests task 5.1: Set up knowledge base storage
 * Requirements: 8.1
 */

import {
  createArticle,
  getArticle,
  updateArticle,
  deleteArticle,
  listArticles,
  incrementViewCount,
  incrementHelpfulCount,
  storeEmbedding,
  getEmbedding,
  cosineSimilarity,
  searchKnowledgeBase,
  extractRelevantSections,
  generateArticleId,
  generateEmbeddingId,
  CreateArticleInput,
} from '../src/services/knowledge-base';
import * as dynamodbClient from '../src/utils/dynamodb-client';

// Mock DynamoDB client
jest.mock('../src/utils/dynamodb-client', () => {
  const mockDocClient = {
    send: jest.fn(),
  };
  return {
    putItem: jest.fn(),
    getItem: jest.fn(),
    queryItems: jest.fn(),
    updateItem: jest.fn(),
    scanItems: jest.fn(),
    docClient: mockDocClient,
    TABLE_NAME: 'novasupport-tickets',
  };
});

describe('Knowledge Base Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (dynamodbClient.putItem as jest.Mock).mockResolvedValue(undefined);
    (dynamodbClient.updateItem as jest.Mock).mockResolvedValue(undefined);
    (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([]);
    (dynamodbClient as any).docClient.send.mockResolvedValue(undefined);
  });

  describe('generateArticleId', () => {
    test('should generate unique article IDs with ART- prefix', () => {
      const id1 = generateArticleId();
      const id2 = generateArticleId();
      expect(id1).toMatch(/^ART-/);
      expect(id2).toMatch(/^ART-/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('generateEmbeddingId', () => {
    test('should generate unique embedding IDs with EMB- prefix', () => {
      const id1 = generateEmbeddingId();
      const id2 = generateEmbeddingId();
      expect(id1).toMatch(/^EMB-/);
      expect(id2).toMatch(/^EMB-/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('createArticle', () => {
    test('should create an article with valid input', async () => {
      const input: CreateArticleInput = {
        title: 'How to reset password',
        content: 'Step 1: Go to settings.\n\nStep 2: Click reset password.',
        category: 'account',
        tags: ['password', 'account'],
        author: 'admin',
      };

      const result = await createArticle(input);

      expect(result.articleId).toMatch(/^ART-/);
      expect(result.PK).toBe(`ARTICLE#${result.articleId}`);
      expect(result.SK).toBe('METADATA');
      expect(result.title).toBe('How to reset password');
      expect(result.content).toBe('Step 1: Go to settings.\n\nStep 2: Click reset password.');
      expect(result.category).toBe('account');
      expect(result.tags).toEqual(['password', 'account']);
      expect(result.author).toBe('admin');
      expect(result.viewCount).toBe(0);
      expect(result.helpfulCount).toBe(0);
      expect(result.embeddingId).toMatch(/^EMB-/);
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(dynamodbClient.putItem).toHaveBeenCalledTimes(1);
    });

    test('should create an article with default empty tags', async () => {
      const input: CreateArticleInput = {
        title: 'Test Article',
        content: 'Some content',
        category: 'general',
        author: 'admin',
      };

      const result = await createArticle(input);
      expect(result.tags).toEqual([]);
    });

    test('should trim whitespace from input fields', async () => {
      const input: CreateArticleInput = {
        title: '  Trimmed Title  ',
        content: '  Trimmed Content  ',
        category: '  general  ',
        author: '  admin  ',
      };

      const result = await createArticle(input);
      expect(result.title).toBe('Trimmed Title');
      expect(result.content).toBe('Trimmed Content');
      expect(result.category).toBe('general');
      expect(result.author).toBe('admin');
    });

    test('should reject empty title', async () => {
      const input: CreateArticleInput = {
        title: '',
        content: 'Content',
        category: 'general',
        author: 'admin',
      };

      await expect(createArticle(input)).rejects.toThrow('Article title is required');
    });

    test('should reject empty content', async () => {
      const input: CreateArticleInput = {
        title: 'Title',
        content: '   ',
        category: 'general',
        author: 'admin',
      };

      await expect(createArticle(input)).rejects.toThrow('Article content is required');
    });

    test('should reject empty category', async () => {
      const input: CreateArticleInput = {
        title: 'Title',
        content: 'Content',
        category: '',
        author: 'admin',
      };

      await expect(createArticle(input)).rejects.toThrow('Article category is required');
    });

    test('should reject empty author', async () => {
      const input: CreateArticleInput = {
        title: 'Title',
        content: 'Content',
        category: 'general',
        author: '',
      };

      await expect(createArticle(input)).rejects.toThrow('Article author is required');
    });
  });

  describe('getArticle', () => {
    test('should return article when found', async () => {
      const mockArticle = {
        PK: 'ARTICLE#ART-123',
        SK: 'METADATA',
        articleId: 'ART-123',
        title: 'Test Article',
        content: 'Test content',
        category: 'general',
        tags: [],
        embeddingId: 'EMB-456',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        author: 'admin',
        viewCount: 0,
        helpfulCount: 0,
      };

      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(mockArticle);

      const result = await getArticle('ART-123');
      expect(result).toEqual(mockArticle);
      expect(dynamodbClient.getItem).toHaveBeenCalledWith('ARTICLE#ART-123', 'METADATA');
    });

    test('should return undefined when article not found', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(undefined);

      const result = await getArticle('ART-nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('updateArticle', () => {
    const mockExistingArticle = {
      PK: 'ARTICLE#ART-123',
      SK: 'METADATA',
      articleId: 'ART-123',
      title: 'Original Title',
      content: 'Original content',
      category: 'general',
      tags: ['tag1'],
      embeddingId: 'EMB-456',
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      author: 'admin',
      viewCount: 5,
      helpfulCount: 2,
    };

    test('should update article title', async () => {
      (dynamodbClient.getItem as jest.Mock)
        .mockResolvedValueOnce(mockExistingArticle)
        .mockResolvedValueOnce({ ...mockExistingArticle, title: 'Updated Title' });

      const result = await updateArticle('ART-123', { title: 'Updated Title' });
      expect(result.title).toBe('Updated Title');
      expect(dynamodbClient.updateItem).toHaveBeenCalledTimes(1);
    });

    test('should update article content', async () => {
      (dynamodbClient.getItem as jest.Mock)
        .mockResolvedValueOnce(mockExistingArticle)
        .mockResolvedValueOnce({ ...mockExistingArticle, content: 'New content' });

      const result = await updateArticle('ART-123', { content: 'New content' });
      expect(result.content).toBe('New content');
    });

    test('should update multiple fields at once', async () => {
      const updated = { ...mockExistingArticle, title: 'New Title', category: 'faq' };
      (dynamodbClient.getItem as jest.Mock)
        .mockResolvedValueOnce(mockExistingArticle)
        .mockResolvedValueOnce(updated);

      const result = await updateArticle('ART-123', { title: 'New Title', category: 'faq' });
      expect(result.title).toBe('New Title');
      expect(result.category).toBe('faq');
    });

    test('should throw when article not found', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(undefined);

      await expect(updateArticle('ART-nonexistent', { title: 'New' }))
        .rejects.toThrow('Article not found: ART-nonexistent');
    });

    test('should reject empty title update', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(mockExistingArticle);

      await expect(updateArticle('ART-123', { title: '   ' }))
        .rejects.toThrow('Article title cannot be empty');
    });

    test('should reject empty content update', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(mockExistingArticle);

      await expect(updateArticle('ART-123', { content: '' }))
        .rejects.toThrow('Article content cannot be empty');
    });

    test('should reject empty category update', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(mockExistingArticle);

      await expect(updateArticle('ART-123', { category: '  ' }))
        .rejects.toThrow('Article category cannot be empty');
    });
  });

  describe('deleteArticle', () => {
    test('should delete an existing article', async () => {
      const mockArticle = {
        articleId: 'ART-123',
        embeddingId: 'EMB-456',
      };
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(mockArticle);

      await deleteArticle('ART-123');
      expect((dynamodbClient as any).docClient.send).toHaveBeenCalled();
    });

    test('should throw when article not found', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(undefined);

      await expect(deleteArticle('ART-nonexistent'))
        .rejects.toThrow('Article not found: ART-nonexistent');
    });
  });

  describe('listArticles', () => {
    test('should list all articles', async () => {
      const mockArticles = [
        { articleId: 'ART-1', title: 'Article 1' },
        { articleId: 'ART-2', title: 'Article 2' },
      ];
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue(mockArticles);

      const result = await listArticles();
      expect(result).toHaveLength(2);
      expect(dynamodbClient.scanItems).toHaveBeenCalled();
    });

    test('should filter articles by category', async () => {
      const mockArticles = [
        { articleId: 'ART-1', title: 'FAQ 1', category: 'faq' },
      ];
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue(mockArticles);

      const result = await listArticles('faq');
      expect(result).toHaveLength(1);
    });

    test('should return empty array when no articles exist', async () => {
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([]);

      const result = await listArticles();
      expect(result).toEqual([]);
    });
  });

  describe('incrementViewCount', () => {
    test('should call updateItem with correct expression', async () => {
      await incrementViewCount('ART-123');
      expect(dynamodbClient.updateItem).toHaveBeenCalledWith(
        'ARTICLE#ART-123',
        'METADATA',
        'SET viewCount = viewCount + :inc',
        { ':inc': 1 }
      );
    });
  });

  describe('incrementHelpfulCount', () => {
    test('should call updateItem with correct expression', async () => {
      await incrementHelpfulCount('ART-123');
      expect(dynamodbClient.updateItem).toHaveBeenCalledWith(
        'ARTICLE#ART-123',
        'METADATA',
        'SET helpfulCount = helpfulCount + :inc',
        { ':inc': 1 }
      );
    });
  });

  describe('storeEmbedding', () => {
    test('should store embedding with correct structure', async () => {
      const vector = [0.1, 0.2, 0.3, 0.4];
      const result = await storeEmbedding('EMB-123', 'ART-456', vector);

      expect(result.PK).toBe('EMBEDDING#EMB-123');
      expect(result.SK).toBe('VECTOR');
      expect(result.embeddingId).toBe('EMB-123');
      expect(result.articleId).toBe('ART-456');
      expect(result.vector).toEqual(vector);
      expect(result.createdAt).toBeDefined();
      expect(dynamodbClient.putItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEmbedding', () => {
    test('should return embedding when found', async () => {
      const mockEmbedding = {
        PK: 'EMBEDDING#EMB-123',
        SK: 'VECTOR',
        embeddingId: 'EMB-123',
        articleId: 'ART-456',
        vector: [0.1, 0.2, 0.3],
        createdAt: '2024-01-01T00:00:00.000Z',
      };
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(mockEmbedding);

      const result = await getEmbedding('EMB-123');
      expect(result).toEqual(mockEmbedding);
      expect(dynamodbClient.getItem).toHaveBeenCalledWith('EMBEDDING#EMB-123', 'VECTOR');
    });

    test('should return undefined when not found', async () => {
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(undefined);

      const result = await getEmbedding('EMB-nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('cosineSimilarity', () => {
    test('should return 1 for identical vectors', () => {
      const v = [1, 2, 3];
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
    });

    test('should return 0 for orthogonal vectors', () => {
      const a = [1, 0];
      const b = [0, 1];
      expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
    });

    test('should return -1 for opposite vectors', () => {
      const a = [1, 0];
      const b = [-1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
    });

    test('should return 0 for empty vectors', () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });

    test('should return 0 for mismatched lengths', () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    test('should return 0 for zero vectors', () => {
      expect(cosineSimilarity([0, 0, 0], [0, 0, 0])).toBe(0);
    });

    test('should compute correct similarity for known vectors', () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      // dot = 4+10+18 = 32, normA = sqrt(14), normB = sqrt(77)
      const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
      expect(cosineSimilarity(a, b)).toBeCloseTo(expected);
    });
  });

  describe('extractRelevantSections', () => {
    test('should split content into paragraphs', () => {
      const content = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
      const sections = extractRelevantSections(content);
      expect(sections).toEqual(['First paragraph.', 'Second paragraph.', 'Third paragraph.']);
    });

    test('should split on markdown headers', () => {
      const content = '# Introduction\nSome intro text.\n## Details\nSome details.';
      const sections = extractRelevantSections(content);
      expect(sections.length).toBeGreaterThanOrEqual(2);
    });

    test('should return empty array for empty content', () => {
      expect(extractRelevantSections('')).toEqual([]);
      expect(extractRelevantSections('   ')).toEqual([]);
    });

    test('should handle single paragraph content', () => {
      const content = 'Just one paragraph with no breaks.';
      const sections = extractRelevantSections(content);
      expect(sections).toEqual(['Just one paragraph with no breaks.']);
    });

    test('should trim whitespace from sections', () => {
      const content = '  First  \n\n  Second  ';
      const sections = extractRelevantSections(content);
      expect(sections).toEqual(['First', 'Second']);
    });
  });

  describe('searchKnowledgeBase', () => {
    test('should return empty results when no embeddings exist', async () => {
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue([]);

      const results = await searchKnowledgeBase([0.1, 0.2, 0.3]);
      expect(results).toEqual([]);
    });

    test('should filter results below 0.6 relevance threshold', async () => {
      const embeddings = [
        {
          PK: 'EMBEDDING#EMB-1',
          SK: 'VECTOR',
          embeddingId: 'EMB-1',
          articleId: 'ART-1',
          vector: [0.1, 0.0, 0.0], // low similarity to query
          createdAt: '2024-01-01T00:00:00.000Z',
        },
      ];
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue(embeddings);

      const queryVector = [0.0, 0.0, 1.0]; // orthogonal to embedding
      const results = await searchKnowledgeBase(queryVector);
      expect(results).toEqual([]);
    });

    test('should return results sorted by relevance descending', async () => {
      const embeddings = [
        {
          embeddingId: 'EMB-1',
          articleId: 'ART-1',
          vector: [0.9, 0.1, 0.0],
        },
        {
          embeddingId: 'EMB-2',
          articleId: 'ART-2',
          vector: [1.0, 0.0, 0.0],
        },
      ];
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue(embeddings);

      const article1 = {
        articleId: 'ART-1',
        title: 'Article 1',
        content: 'Content 1',
      };
      const article2 = {
        articleId: 'ART-2',
        title: 'Article 2',
        content: 'Content 2',
      };

      (dynamodbClient.getItem as jest.Mock)
        .mockImplementation((pk: string) => {
          if (pk === 'ARTICLE#ART-1') return Promise.resolve(article1);
          if (pk === 'ARTICLE#ART-2') return Promise.resolve(article2);
          return Promise.resolve(undefined);
        });

      const queryVector = [1.0, 0.0, 0.0];
      const results = await searchKnowledgeBase(queryVector);

      expect(results.length).toBeGreaterThan(0);
      // Results should be sorted by relevance descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].relevanceScore).toBeGreaterThanOrEqual(results[i].relevanceScore);
      }
    });

    test('should respect limit option', async () => {
      const embeddings = Array.from({ length: 5 }, (_, i) => ({
        embeddingId: `EMB-${i}`,
        articleId: `ART-${i}`,
        vector: [1.0, 0.0, 0.0], // all identical, high similarity
      }));
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue(embeddings);

      (dynamodbClient.getItem as jest.Mock).mockImplementation((pk: string) => {
        const id = pk.replace('ARTICLE#', '');
        return Promise.resolve({
          articleId: id,
          title: `Article ${id}`,
          content: 'Content',
        });
      });

      const results = await searchKnowledgeBase([1.0, 0.0, 0.0], { limit: 2 });
      expect(results.length).toBeLessThanOrEqual(2);
    });

    test('should use custom minRelevance threshold', async () => {
      const embeddings = [
        {
          embeddingId: 'EMB-1',
          articleId: 'ART-1',
          vector: [0.8, 0.6, 0.0], // moderate similarity
        },
      ];
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue(embeddings);

      const article = {
        articleId: 'ART-1',
        title: 'Article 1',
        content: 'Content',
      };
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(article);

      // With high threshold, should filter out
      const results = await searchKnowledgeBase([1.0, 0.0, 0.0], { minRelevance: 0.99 });
      expect(results).toEqual([]);
    });

    test('should include relevantSections from article content', async () => {
      const embeddings = [
        {
          embeddingId: 'EMB-1',
          articleId: 'ART-1',
          vector: [1.0, 0.0, 0.0],
        },
      ];
      (dynamodbClient.scanItems as jest.Mock).mockResolvedValue(embeddings);

      const article = {
        articleId: 'ART-1',
        title: 'Password Reset',
        content: 'Step 1: Go to settings.\n\nStep 2: Click reset.',
      };
      (dynamodbClient.getItem as jest.Mock).mockResolvedValue(article);

      const results = await searchKnowledgeBase([1.0, 0.0, 0.0]);
      expect(results).toHaveLength(1);
      expect(results[0].relevantSections).toEqual(['Step 1: Go to settings.', 'Step 2: Click reset.']);
      expect(results[0].title).toBe('Password Reset');
      expect(results[0].articleId).toBe('ART-1');
    });
  });
});

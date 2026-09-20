import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
} from 'antd';
import type { Item } from '@proj/api';
import { useLocation } from 'wouter';
import { api, errorMessage } from '../api';
export function HomePage() {
  const [, navigate] = useLocation();
  const [url, setUrl] = useState(() => window.location.search);
  const params = new URLSearchParams(url),
    page = Math.max(1, Number(params.get('page')) || 1),
    search = params.get('search') || '',
    order = params.get('order') === 'desc' ? 'desc' : 'asc';
  const [items, setItems] = useState<Item[]>([]),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [editing, setEditing] = useState<Item | null | undefined>(undefined),
    [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ name: string }>();
  const controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError('');
    try {
      const data = await api.items.list(
        { page, limit: 10, search, sort: 'name', order },
        current.signal,
      );
      if (!current.signal.aborted) {
        setItems(data.items);
        setTotal(data.total);
      }
    } catch (e) {
      if (!current.signal.aborted) setError(errorMessage(e));
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [page, search, order]);
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);
  useEffect(() => {
    const sync = () => setUrl(window.location.search);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const change = (patch: Record<string, string>) => {
    const next = new URLSearchParams(url);
    for (const [key, value] of Object.entries(patch)) next.set(key, value);
    const query = '?' + next.toString();
    navigate('/' + query);
    setUrl(query);
  };
  async function save() {
    if (busy) return;
    try {
      const input = await form.validateFields();
      setBusy(true);
      if (editing) await api.items.update(editing.id, input.name);
      else await api.items.create(input.name);
      setEditing(undefined);
      await load();
    } catch (e) {
      if (e instanceof Error) setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h1>Items</h1>
      <Space wrap>
        <Input.Search
          aria-label="Search items"
          defaultValue={search}
          onSearch={(value) => change({ search: value, page: '1' })}
        />
        <Button
          type="primary"
          onClick={() => {
            form.resetFields();
            setEditing(null);
          }}
        >
          Add item
        </Button>
      </Space>
      {error && (
        <Alert
          type="error"
          title={error}
          action={<Button onClick={() => void load()}>Retry</Button>}
        />
      )}
      <Table<Item>
        rowKey="id"
        dataSource={items}
        loading={loading}
        scroll={{ x: 480 }}
        pagination={{
          current: page,
          total,
          pageSize: 10,
          showSizeChanger: false,
        }}
        onChange={(pagination, _filters, sorter) =>
          change({
            page: String(pagination.current || 1),
            order:
              !Array.isArray(sorter) && sorter.order === 'descend'
                ? 'desc'
                : 'asc',
          })
        }
        columns={[
          {
            title: 'Name',
            dataIndex: 'name',
            sorter: true,
            sortOrder: order === 'desc' ? 'descend' : 'ascend',
          },
          {
            title: 'Actions',
            render: (_value, item) => (
              <Space>
                <Button
                  onClick={() => {
                    form.setFieldsValue({ name: item.name });
                    setEditing(item);
                  }}
                >
                  Edit
                </Button>
                <Popconfirm
                  title="Delete this item?"
                  onConfirm={async () => {
                    try {
                      await api.items.delete(item.id);
                      await load();
                    } catch (e) {
                      setError(errorMessage(e));
                    }
                  }}
                >
                  <Button danger>Delete</Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? 'Edit item' : 'New item'}
        open={editing !== undefined}
        confirmLoading={busy}
        onOk={() => void save()}
        onCancel={() => {
          if (!busy) setEditing(undefined);
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, whitespace: true, max: 200 }]}
          >
            <Input maxLength={200} />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

// Package deck implements the OpenAction / Stream Deck plugin websocket
// protocol.
package deck

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/gorilla/websocket"
)

type Coordinates struct {
	Column int `json:"column"`
	Row    int `json:"row"`
}

type Event struct {
	Event   string `json:"event"`
	Action  string `json:"action"`
	Context string `json:"context"`
	Device  string `json:"device"`
	Payload struct {
		Coordinates Coordinates     `json:"coordinates"`
		Settings    json.RawMessage `json:"settings"`
	} `json:"payload"`
}

type Client struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

func Connect(port int, registerEvent, pluginUUID string) (*Client, error) {
	conn, _, err := websocket.DefaultDialer.Dial(fmt.Sprintf("ws://127.0.0.1:%d", port), nil)
	if err != nil {
		return nil, err
	}
	client := &Client{conn: conn}
	if err := client.send(map[string]any{"event": registerEvent, "uuid": pluginUUID}); err != nil {
		conn.Close()
		return nil, err
	}
	return client, nil
}

func (c *Client) Read() (*Event, error) {
	_, data, err := c.conn.ReadMessage()
	if err != nil {
		return nil, err
	}
	var event Event
	if err := json.Unmarshal(data, &event); err != nil {
		return nil, err
	}
	return &event, nil
}

func (c *Client) SetImage(context, image string) error {
	return c.send(map[string]any{
		"event":   "setImage",
		"context": context,
		"payload": map[string]any{"image": image},
	})
}

func (c *Client) ShowAlert(context string) error {
	return c.send(map[string]any{"event": "showAlert", "context": context})
}

func (c *Client) LogMessage(message string) error {
	return c.send(map[string]any{
		"event":   "logMessage",
		"payload": map[string]any{"message": message},
	})
}

func (c *Client) send(value any) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.conn.WriteJSON(value)
}
